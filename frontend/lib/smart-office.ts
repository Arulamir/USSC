export type OfficeMeterQuality = {
  meter_used: number;
  meter_expected: number;
};

export type SmartOfficeSnapshot = {
  sampled_at_utc: string;
  interval_minutes: number;
  stale: boolean;
  ac_power_w: number | null;
  ac_minute_wh?: number | null;
  ac_minute_stale?: boolean;
  ac_minute_start_utc?: string | null;
  ac_minute_end_utc?: string | null;
  ac_minute_quality?: OfficeMeterQuality & { estimated: boolean };
  lamp_power_w: number | null;
  power_interval_minutes?: number;
  power_stale?: boolean;
  power_sampled_at_utc?: string | null;
  power_observed_at_utc?: string | null;
  lamp_power_observed_at_utc?: string | null;
  ac_day_wh?: number | null;
  lamp_day_wh?: number | null;
  energy_date_wib?: string;
  occupancy: "occupied" | "vacant" | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  illumination: "bright" | "dim" | null;
  power_quality: {
    ac: OfficeMeterQuality;
    lamp: OfficeMeterQuality;
  };
};

export type SmartOfficeResponse = {
  status: "success";
  data: SmartOfficeSnapshot | null;
};

export type OfficePeriod = "daily" | "weekly" | "monthly" | "yearly";

export type OfficeEnergyBucket = {
  label: string;
  start_utc: string;
  end_utc: string;
  ac_wh: number | null;
  lamp_wh: number | null;
  ac_status: string;
  lamp_status: string;
  ac_detail: OfficeMeterQuality;
  lamp_detail: OfficeMeterQuality;
  in_progress: boolean;
};

export type OfficeHistory = {
  status: "success";
  period: OfficePeriod;
  date: string;
  start_wib: string;
  end_wib: string;
  generated_at_utc: string;
  unit: "Wh";
  data: OfficeEnergyBucket[];
  totals: {
    ac_wh: number | null;
    lamp_wh: number | null;
    ac_available_buckets: number;
    lamp_available_buckets: number;
    bucket_count: number;
    ac_partial: boolean;
    lamp_partial: boolean;
    ac_status: string;
    lamp_status: string;
  };
};
