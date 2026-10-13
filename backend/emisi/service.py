from backend.emisi.emisi import hitung_total_emisi


def proses_emisi(
    vehicle_id,
    camera_id,
    tanggal,
    jam,

    motor,
    mobil,
    bus,
    truck,

    conn,
    cursor
):

    try:

        # =====================================================
        # HITUNG EMISI
        #
        # motor/mobil/bus/truck di sini adalah DELTA
        # =====================================================

        hasil = hitung_total_emisi(
            motor=motor,
            mobil=mobil,
            bus=bus,
            truk=truck
        )


        # =====================================================
        # SIMPAN EMISSION DATA
        #
        # 1 vehicle_id = 1 hasil emisi dari 1 incoming data
        # =====================================================

        cursor.execute("""
            INSERT INTO emission_data
            (
                vehicle_id,
                emission_motor,
                emission_mobil,
                emission_bus,
                emission_truk,
                emission_total
            )
            VALUES
            (
                %s, %s, %s, %s, %s, %s
            )
        """, (
            vehicle_id,

            hasil["motor"],
            hasil["mobil"],
            hasil["bus"],
            hasil["truk"],
            hasil["total"]
        ))


        # =====================================================
        # UPDATE EMISSION HOURLY
        #
        # Emisi per jam = akumulasi emisi dari DELTA kendaraan
        # =====================================================

        cursor.execute("""
            INSERT INTO emission_hourly
            (
                camera_id,
                tanggal,
                jam,

                motor,
                mobil,
                bus,
                truck,
                total
            )
            VALUES
            (
                %s, %s, %s,

                %s, %s, %s, %s, %s
            )

            ON DUPLICATE KEY UPDATE

                motor = motor + VALUES(motor),
                mobil = mobil + VALUES(mobil),
                bus = bus + VALUES(bus),
                truck = truck + VALUES(truck),
                total = total + VALUES(total)
        """, (
            camera_id,
            tanggal,
            jam,

            hasil["motor"],
            hasil["mobil"],
            hasil["bus"],
            hasil["truk"],
            hasil["total"]
        ))


        print("✓ Emisi berhasil dihitung")

        print(f"  Vehicle ID : {vehicle_id}")
        print(f"  Camera     : {camera_id}")
        print(f"  Tanggal    : {tanggal}")
        print(f"  Jam        : {jam:02d}:00")

        print(f"  Motor      : {hasil['motor']}")
        print(f"  Mobil      : {hasil['mobil']}")
        print(f"  Bus        : {hasil['bus']}")
        print(f"  Truk       : {hasil['truk']}")
        print(f"  Total      : {hasil['total']}")


        return hasil


    except Exception as e:

        print(
            "ERROR proses emisi:",
            e
        )

        raise