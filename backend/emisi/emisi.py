# =====================================================
# PARAMETER EMISI
# =====================================================

JARAK_KM = 2
JUMLAH_PERJALANAN = 2

FAKTOR_MOTOR = 0.01
FAKTOR_MOBIL = 0.02
FAKTOR_BUS = 0.01
FAKTOR_TRUK = 0.01


# =====================================================
# HITUNG EMISI
# =====================================================

def hitung_emisi(jumlah_kendaraan, faktor_emisi):

    return (
        jumlah_kendaraan
        * JUMLAH_PERJALANAN
        * JARAK_KM
        / 100
        * faktor_emisi
    )


# =====================================================
# TOTAL EMISI
# =====================================================

def hitung_total_emisi(
    motor,
    mobil,
    bus,
    truk
):

    emisi_motor = hitung_emisi(
        motor,
        FAKTOR_MOTOR
    )

    emisi_mobil = hitung_emisi(
        mobil,
        FAKTOR_MOBIL
    )

    emisi_bus = hitung_emisi(
        bus,
        FAKTOR_BUS
    )

    emisi_truk = hitung_emisi(
        truk,
        FAKTOR_TRUK
    )


    total = (
        emisi_motor
        + emisi_mobil
        + emisi_bus
        + emisi_truk
    )


    return {
        "motor": round(emisi_motor, 4),
        "mobil": round(emisi_mobil, 4),
        "bus": round(emisi_bus, 4),
        "truk": round(emisi_truk, 4),
        "total": round(total, 4)
    }