from sendesp import connect_mqtt, publish_monitoring
import time


if connect_mqtt():

    data = {
        "traffic": {
            "motor": 10,
            "mobil": 5,
            "bus": 1,
            "truk": 2
        },
        "air_quality": {
            "pm25": 20.5,
            "pm10": 25.2,
            "co2": 450,
            "temperature": 30.2,
            "humidity": 60
        }
    }

    publish_monitoring(data)

    time.sleep(3)