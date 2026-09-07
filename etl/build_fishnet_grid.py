"""
build_fishnet_grid.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Membuat fishnet grid (grid analisis 250-500 m) untuk Transit Desert Index
(TDI), sesuai Bab 3 & 7 PRD: "Disagregasi data kependudukan ke grid analisis
250-500 m melalui dasymetric mapping (estimasi, bukan sensus)".

Fishnet grid = grid kotak-kotak seragam yang menutupi seluruh area studi
(Kota Bekasi), dipakai sebagai unit analisis TDI di compute_scores.compute_tdi()
— tiap cell jadi satu baris tabel grid_analisis. Dibutuhkan karena data
kependudukan resmi (BPS/Dukcapil) hanya tersedia per kelurahan, padahal TDI
perlu granularitas lebih halus (250-500 m) supaya kantong "transit desert" di
dalam satu kelurahan besar tidak tersamarkan oleh rata-rata kelurahan.

Alur:
  1. generate_fishnet()                    -> buat grid kotak menutupi area studi
  2. clip_to_boundary()                    -> (opsional) buang cell di luar batas Kota Bekasi
  3. disaggregate_population_dasymetric()  -> sebar populasi kelurahan ke tiap cell,
                                               dibobot luas building footprint (kalau ada)
  4. build_grid_records_for_db()/insert_grid_to_supabase() -> siap diupload ke grid_analisis

Cara pakai:
    python build_fishnet_grid.py          # jalankan demo dengan data sintetis
    (nanti) python build_fishnet_grid.py --boundary data/raw/batas_kelurahan_bekasi.geojson \
                                          --buildings data/raw/osm_building_footprint.geojson

TODO integrasi selanjutnya (belum dikerjakan di sini, butuh data asli):
  - Ganti load_demo_boundary()/load_demo_buildings() dengan:
      * batas kelurahan Kota Bekasi asli (BIG/BPS) + kolom jumlah_penduduk
        (BPS Kota Bekasi Dalam Angka / Dukcapil) — sama dengan yang nanti
        mengisi tabel batas_administrasi di Supabase
      * building footprint asli dari OpenStreetMap (Overpass API / geofabrik
        extract, filter tag building=*)
  - Untuk skala penuh kota (~210 km² / cell 300m -> ribuan cell x puluhan
    kelurahan), ganti loop di disaggregate_population_dasymetric() dengan
    geopandas.sjoin() + groupby supaya tidak lambat — loop di bawah ini
    sengaja simpel/mudah dibaca untuk skala demo, bukan dioptimalkan.
  - Setelah grid final, insert SEKALI ke Supabase lewat insert_grid_to_supabase()
    (geom tidak berubah lagi setelahnya). Skor TDI-nya sendiri diupdate
    berulang lewat upload_to_supabase.upload_tdi_scores(), yang butuh kolom
    id hasil insert ini sebagai 'grid_analisis_id'.
"""

from __future__ import annotations

import geopandas as gpd
from shapely.geometry import box

WGS84 = "EPSG:4326"
# UTM 48S — proyeksi meter yang mencakup Kota Bekasi, dipakai supaya ukuran
# cell fishnet betul-betul 250-500 meter (bukan 250-500 "derajat" kalau
# dihitung langsung di EPSG:4326 yang satuannya derajat).
METRIC_CRS = "EPSG:32748"

DEFAULT_CELL_SIZE_M = 300  # tengah-tengah rentang 250-500 m yang diminta PRD


def generate_fishnet(bounds_wgs84: tuple, cell_size_m: float = DEFAULT_CELL_SIZE_M) -> gpd.GeoDataFrame:
    """
    Buat grid kotak-kotak (fishnet) menutupi bounding box `bounds_wgs84`
    (minx, miny, maxx, maxy dalam lon/lat EPSG:4326), ukuran cell dalam meter.

    Return: GeoDataFrame kolom ['grid_id', 'geometry'] dalam EPSG:4326, siap
    dipakai sebagai unit analisis TDI (satu baris = satu calon baris
    grid_analisis).
    """
    bbox_metric = gpd.GeoSeries([box(*bounds_wgs84)], crs=WGS84).to_crs(METRIC_CRS)
    minx, miny, maxx, maxy = bbox_metric.total_bounds

    cells = []
    row = 0
    y = miny
    while y < maxy:
        col = 0
        x = minx
        while x < maxx:
            cells.append({
                "grid_id": f"GRID-R{row:03d}C{col:03d}",
                "geometry": box(x, y, x + cell_size_m, y + cell_size_m),
            })
            x += cell_size_m
            col += 1
        y += cell_size_m
        row += 1

    grid = gpd.GeoDataFrame(cells, crs=METRIC_CRS)
    return grid.to_crs(WGS84)


def clip_to_boundary(
    grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame, predicate: str = "intersects"
) -> gpd.GeoDataFrame:
    """
    Buang cell fishnet yang sama sekali di luar batas area studi (mis. batas
    administrasi Kota Bekasi). Sengaja pakai filter predikat ('intersects'),
    BUKAN potong geometris (gpd.clip), supaya tiap cell yang tersisa tetap
    kotak utuh berukuran sama persis — dibutuhkan supaya kepadatan (jiwa per
    cell) antar cell tetap bisa dibandingkan apel-ke-apel di formula TDI.
    """
    if boundary.crs != grid.crs:
        boundary = boundary.to_crs(grid.crs)
    # union_all() sejak GeoPandas 1.0. Nama atribut lama disimpan di variabel
    # (bukan ditulis langsung) supaya type checker tidak ikut menandai properti
    # deprecated itu, sementara tim yang masih pakai GeoPandas <1.0 tetap jalan.
    if hasattr(boundary, "union_all"):
        dissolved = boundary.union_all()
    else:
        atribut_lama = "unary_union"
        dissolved = getattr(boundary, atribut_lama)
    mask = grid.geometry.apply(lambda geom: getattr(geom, predicate)(dissolved))
    return grid[mask].reset_index(drop=True)


def disaggregate_population_dasymetric(
    grid: gpd.GeoDataFrame,
    kelurahan: gpd.GeoDataFrame,
    population_column: str = "jumlah_penduduk",
    buildings: gpd.GeoDataFrame = None,
) -> gpd.GeoDataFrame:
    """
    Sebar populasi per kelurahan ke tiap cell grid yang beririsan dengannya
    (dasymetric mapping), sesuai Bab 7 PRD.

    Dua mode bobot:
      - Kalau `buildings` (footprint OSM) disediakan: populasi kelurahan
        disebar proporsional terhadap total luas building footprint di tiap
        cell (cell yang lebih padat bangunan dapat porsi penduduk lebih
        besar) — mendekati asumsi "penduduk tinggal di bangunan, bukan di
        lapangan kosong/RTH".
      - Kalau tidak ada `buildings`: fallback ke bobot luas cell yang
        beririsan dengan kelurahan (areal weighting) — lebih kasar. PRD
        eksplisit menyebut hasil disagregasi ini "estimasi, bukan sensus",
        jadi fallback ini didokumentasikan sebagai keterbatasan, bukan
        disembunyikan.

    Properti yang dijaga (dan diverifikasi di demo __main__): total populasi
    hasil sebaran di semua cell yang beririsan satu kelurahan = populasi
    asli kelurahan itu (konservasi jumlah, bukan cuma proporsi relatif).

    Return: grid + kolom baru 'kepadatan_penduduk' (estimasi jiwa per cell,
    nama kolom disamakan dengan skema tabel grid_analisis).
    """
    out = grid.copy()
    out["kepadatan_penduduk"] = 0.0

    metric_grid = out.to_crs(METRIC_CRS)
    metric_kelurahan = kelurahan.to_crs(METRIC_CRS)
    metric_buildings = buildings.to_crs(METRIC_CRS) if buildings is not None else None

    for _, kel in metric_kelurahan.iterrows():
        total_pop = kel[population_column]
        kel_geom = kel.geometry

        overlap_mask = metric_grid.geometry.intersects(kel_geom)
        candidate_idx = metric_grid.index[overlap_mask]
        if len(candidate_idx) == 0:
            continue  # kelurahan ini tidak beririsan cell manapun di grid saat ini

        if metric_buildings is not None:
            weights = []
            for idx in candidate_idx:
                cell_in_kel = metric_grid.geometry.loc[idx].intersection(kel_geom)
                bldg_in_cell = metric_buildings[metric_buildings.intersects(cell_in_kel)]
                bldg_area = bldg_in_cell.geometry.intersection(cell_in_kel).area.sum()
                weights.append(bldg_area)
        else:
            weights = [
                metric_grid.geometry.loc[idx].intersection(kel_geom).area
                for idx in candidate_idx
            ]

        total_weight = sum(weights)
        if total_weight == 0:
            # Tidak ada bangunan/luas irisan terdeteksi (mis. building
            # footprint belum menutupi area ini) -> sebar rata supaya
            # populasi kelurahan ini tidak hilang begitu saja dari total.
            weights = [1] * len(candidate_idx)
            total_weight = len(candidate_idx)

        for idx, w in zip(candidate_idx, weights):
            out.loc[idx, "kepadatan_penduduk"] += total_pop * (w / total_weight)

    return out


def to_ewkt(geometry) -> str:
    """Format geometry Shapely jadi EWKT ('SRID=4326;POLYGON(...)') — format
    text yang diterima Supabase/PostgREST untuk kolom bertipe geometry."""
    return f"SRID=4326;{geometry.wkt}"


def build_grid_records_for_db(grid: gpd.GeoDataFrame) -> list[dict]:
    """
    Susun grid jadi list of dict siap insert ke tabel grid_analisis lewat
    supabase-py (lihat insert_grid_to_supabase()).
    """
    records = []
    for _, row in grid.iterrows():
        records.append({
            "geom": to_ewkt(row.geometry),
            "kepadatan_penduduk": round(float(row.get("kepadatan_penduduk", 0)), 2),
        })
    return records


def insert_grid_to_supabase(client, grid: gpd.GeoDataFrame):
    """
    Insert grid (dengan geom) ke grid_analisis — dijalankan SEKALI di awal
    analisis (geom tidak berubah lagi setelahnya). Setelah ini, skor TDI
    diupdate berulang lewat upload_to_supabase.upload_tdi_scores(), yang
    butuh kolom 'id' hasil insert ini sebagai 'grid_analisis_id'.

    Tidak dipanggil otomatis di __main__ supaya build_fishnet_grid.py tetap
    bisa dicoba tanpa kredensial Supabase (lihat README "SUDAH bisa dicoba
    sekarang"). Contoh pemakaian setelah kredensial siap:

        from upload_to_supabase import get_client
        from build_fishnet_grid import generate_fishnet, insert_grid_to_supabase
        client = get_client()
        grid = generate_fishnet(bounds_kota_bekasi)
        insert_grid_to_supabase(client, grid)
    """
    records = build_grid_records_for_db(grid)
    result = client.table("grid_analisis").insert(records).execute()
    print(f"Berhasil insert {len(records)} baris grid_analisis baru.")
    return result


# ------------------------------------------------------------------
# Data loader placeholder & demo
# ------------------------------------------------------------------

def load_demo_boundary() -> gpd.GeoDataFrame:
    """Batas 'kelurahan' sintetis (2 poligon persegi bersebelahan) di
    sekitar pusat Kota Bekasi — GANTI dengan batas_administrasi asli
    (BIG/BPS) begitu tersedia."""
    # Pusat referensi sama dengan BEKASI_CENTER di
    # frontend/src/components/Map/MapView.jsx supaya konsisten dgn demo lain.
    return gpd.GeoDataFrame(
        {
            "nama_kelurahan": ["Kelurahan Demo A", "Kelurahan Demo B"],
            "jumlah_penduduk": [12000, 8000],
        },
        geometry=[
            box(107.000, -6.222, 107.010, -6.212),
            box(107.010, -6.222, 107.020, -6.212),
        ],
        crs=WGS84,
    )


def load_demo_buildings() -> gpd.GeoDataFrame:
    """Building footprint sintetis — beberapa 'bangunan' sengaja
    dikonsentrasikan di satu pojok grid supaya efek dasymetric weighting
    kelihatan jelas (dibanding fallback areal weighting yang menyebar rata
    ke semua cell). GANTI dengan ekstrak OpenStreetMap asli (building=*)
    begitu tersedia."""
    footprints = []
    for i in range(6):
        fx = 107.0005 + (i % 3) * 0.0012
        fy = -6.2205 + (i // 3) * 0.0012
        footprints.append(box(fx, fy, fx + 0.0008, fy + 0.0008))
    return gpd.GeoDataFrame({"jenis": ["bangunan"] * len(footprints)}, geometry=footprints, crs=WGS84)


if __name__ == "__main__":
    print("=== Demo build_fishnet_grid — data sintetis ===\n")

    boundary = load_demo_boundary()
    bounds = tuple(boundary.total_bounds)
    print(f"Area studi (demo): {len(boundary)} kelurahan, bounds={tuple(round(b, 5) for b in bounds)}")

    grid = generate_fishnet(bounds, cell_size_m=300)
    print(f"Fishnet mentah: {len(grid)} cell (300m x 300m)")

    grid = clip_to_boundary(grid, boundary)
    print(f"Setelah clip ke batas kelurahan demo: {len(grid)} cell tersisa\n")

    print("--- Mode 1: areal weighting (tanpa building footprint) ---")
    grid_areal = disaggregate_population_dasymetric(grid, boundary)
    print(grid_areal[["grid_id", "kepadatan_penduduk"]].round(1).to_string(index=False))
    total_asli = boundary["jumlah_penduduk"].sum()
    total_sebar_areal = grid_areal["kepadatan_penduduk"].sum()
    print(f"Total populasi asli: {total_asli} | Total setelah disebar ke grid: {total_sebar_areal:.1f}")
    assert abs(total_asli - total_sebar_areal) < 1.0, "Populasi harus konservatif (tidak hilang/nambah saat disebar)"

    print("\n--- Mode 2: dasymetric weighting (dengan building footprint) ---")
    buildings = load_demo_buildings()
    grid_dasy = disaggregate_population_dasymetric(grid, boundary, buildings=buildings)
    print(grid_dasy[["grid_id", "kepadatan_penduduk"]].round(1).to_string(index=False))
    total_sebar_dasy = grid_dasy["kepadatan_penduduk"].sum()
    print(f"Total populasi asli: {total_asli} | Total setelah disebar (dasymetric): {total_sebar_dasy:.1f}")
    assert abs(total_asli - total_sebar_dasy) < 1.0, "Populasi harus konservatif (tidak hilang/nambah saat disebar)"

    print(
        "\nBandingkan dua mode di atas: pada mode dasymetric, populasi lebih "
        "terkonsentrasi di cell yang beririsan klaster bangunan sintetis "
        "(Kelurahan Demo A, pojok barat daya), bukan tersebar rata seperti "
        "mode areal weighting — ini yang dimaksud 'dasymetric mapping' di "
        "Bab 7 PRD."
    )

    out_path = "../data/processed/demo_fishnet_grid.geojson"
    try:
        grid_dasy.to_file(out_path, driver="GeoJSON")
        print(f"\nGrid demo diekspor ke {out_path} (bisa dibuka di QGIS untuk cek visual).")
    except Exception as e:
        print(f"\n[PERINGATAN] Gagal ekspor GeoJSON demo: {e}")
