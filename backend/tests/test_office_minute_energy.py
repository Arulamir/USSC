import unittest
from datetime import timedelta
from flask import Flask

from backend.api.smart_office import AC_METERS, minute_power_data
from backend.tests.test_office_minute_power import NOW, packet


def energy_packet(offsets=(-120, -60, 0), values=(1000, 1100, 1110)):
    data = packet()
    for record in data['records']:
        record['power_w'] = 2
        if record['device_eui'] in AC_METERS:
            record['energy_points'] = [
                {'at': (NOW + timedelta(seconds=offset)).isoformat(), 'wh': value}
                for offset, value in zip(offsets, values)
            ]
    return data


class MinuteEnergyTests(unittest.TestCase):
    def setUp(self):
        context = Flask(__name__).app_context()
        context.push()
        self.addCleanup(context.pop)

    def test_only_latest_minute_not_counter_or_earlier_usage_or_active_power(self):
        data = minute_power_data(energy_packet(), NOW)
        self.assertEqual(data['ac_minute_wh'], 40)  # 4 x (1110 - 1100)
        self.assertEqual(data['ac_power_w'], 8)
        self.assertEqual(data['lamp_power_w'], 8)
        self.assertEqual(data['ac_minute_start_utc'], '2026-10-17T05:59:00.000Z')
        self.assertFalse(data['ac_minute_quality']['estimated'])

    def test_real_zero_valid_but_missing_is_not_zero(self):
        self.assertEqual(minute_power_data(energy_packet(values=(0, 0, 0)), NOW)['ac_minute_wh'], 0)
        self.assertIsNone(minute_power_data(packet(), NOW)['ac_minute_wh'])

    def test_old_future_and_republished_counters_do_not_renew_age(self):
        payload = energy_packet(offsets=(-360, -300, -240))
        self.assertIsNone(minute_power_data(payload, NOW)['ac_minute_wh'])
        for record in payload['records']:
            if record['device_eui'] in AC_METERS:
                record['energy_points'][-1]['at'] = (NOW + timedelta(seconds=1)).isoformat()
        self.assertIsNone(minute_power_data(payload, NOW)['ac_minute_wh'])

    def test_ten_minute_change_cannot_be_shown_as_one_minute(self):
        self.assertIsNone(minute_power_data(energy_packet(offsets=(-1200, -600, 0)), NOW)['ac_minute_wh'])

    def test_retained_old_packet_cannot_become_fresh_minute_wh(self):
        payload = energy_packet(offsets=(-240, -180, -120))
        payload['sampled_at_utc'] = (NOW - timedelta(seconds=151)).isoformat()
        for record in payload['records']:
            record['power_w_at'] = payload['sampled_at_utc']
            if record['device_eui'] in AC_METERS:
                record['energy_points'][-1]['at'] = payload['sampled_at_utc']
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['lamp_power_w'], 8)
        self.assertTrue(data['power_previous'])
        self.assertIsNone(data['ac_minute_wh'])

    def test_reset_needs_new_full_minute(self):
        payload = energy_packet(values=(1000, 1100, 5))
        self.assertIsNone(minute_power_data(payload, NOW)['ac_minute_wh'])
        self.assertEqual(minute_power_data(energy_packet(values=(1100, 5, 15)), NOW)['ac_minute_wh'], 40)

    def test_common_window_for_asynchronous_meters(self):
        payload = energy_packet()
        ac = [r for r in payload['records'] if r['device_eui'] in AC_METERS]
        ac[0]['energy_points'] = [
            {'at': (NOW + timedelta(seconds=s)).isoformat(), 'wh': w}
            for s, w in [(-150, 0), (-90, 6), (-30, 12)]
        ]
        data = minute_power_data(payload, NOW)
        # Common end -30 s: each of the other three uses half the old and new intervals.
        self.assertEqual(data['ac_minute_wh'], 171)
        self.assertEqual(data['ac_minute_end_utc'], '2026-10-17T05:59:30.000Z')
        self.assertTrue(data['ac_minute_quality']['estimated'])

    def test_partial_duplicate_and_conflicting_meter_excluded(self):
        payload = energy_packet()
        ac = [r for r in payload['records'] if r['device_eui'] in AC_METERS]
        ac[0]['energy_points'].append({**ac[0]['energy_points'][-1], 'wh': 9999})
        ac[1]['energy_points'] = []
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_minute_wh'], 20)
        self.assertEqual(data['ac_minute_quality']['meter_used'], 2)
        ac[0]['device_eui'] = ac[2]['device_eui']
        self.assertEqual(minute_power_data(payload, NOW)['ac_minute_wh'], 10)

    def test_invalid_unbounded_and_boolean_values_unavailable(self):
        for points in ([{'at': NOW.isoformat(), 'wh': True}] * 2,
                       [{'at': NOW.isoformat(), 'wh': 1}] * 17,
                       [None, None], [{'at': 'bad', 'wh': 1}] * 2):
            with self.subTest(points=points):
                payload = energy_packet()
                for r in payload['records']:
                    r['energy_points'] = points
                self.assertIsNone(minute_power_data(payload, NOW)['ac_minute_wh'])


if __name__ == '__main__':
    unittest.main()
