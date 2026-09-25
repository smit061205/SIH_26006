-- FREIGHTWISE reference data schema.
--
-- This is the "later phase" Postgres data layer named in the project spec.
-- It is NOT required to run the app - src/data_loader.py reads CSVs by
-- default, and that stays the default for local dev because it needs zero
-- infrastructure. This schema exists for when the team is ready to move
-- off flat files (e.g. once SAIL's own booking history / ERP data needs
-- to be ingested rather than hand-maintained CSVs).
--
-- Mirrors data/*.csv column-for-column, including the data_confidence
-- columns - the honesty/provenance tracking this project relies on
-- throughout doesn't go away just because the storage layer changes.

CREATE TABLE IF NOT EXISTS ports (
    port_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    max_draft_m NUMERIC NOT NULL,
    monsoon_draft_reduction_m NUMERIC NOT NULL,
    loa_max_m NUMERIC,
    beam_max_m NUMERIC,
    vessel_classes_allowed TEXT NOT NULL, -- comma-separated, matches CSV; see note below
    avg_wait_days_min NUMERIC NOT NULL,
    avg_wait_days_max NUMERIC NOT NULL,
    port_charges_flat_usd NUMERIC NOT NULL,
    port_charges_per_tonne_usd NUMERIC NOT NULL,
    notes TEXT,
    data_confidence TEXT NOT NULL,
    latitude NUMERIC,
    longitude NUMERIC,
    monsoon_start_month INTEGER,
    monsoon_end_month INTEGER,
    monsoon_closed BOOLEAN,
    discharge_rate_tpd NUMERIC,
    weather_delay_days_monsoon NUMERIC,
    port_type TEXT,
    rail_via_port TEXT,
    transshipment_cost_usd_per_tonne NUMERIC,
    transshipment_days NUMERIC,
    ops_notes TEXT,
    ops_data_confidence TEXT,
    handling_type TEXT,
    shore_equipment TEXT,
    handling_source TEXT
);
-- vessel_classes_allowed is kept as a comma-separated string (not
-- normalized into a join table) to match src/data_loader.py's
-- `.split(",")` parsing exactly - normalize this properly if/when the
-- Python loader is rewritten to query Postgres directly instead of CSV.

CREATE TABLE IF NOT EXISTS vessel_classes (
    vessel_class TEXT PRIMARY KEY,
    dwt_min INTEGER NOT NULL,
    dwt_max INTEGER NOT NULL,
    draft_laden_m NUMERIC NOT NULL,
    loa_m NUMERIC NOT NULL,
    beam_m NUMERIC NOT NULL,
    depth_m NUMERIC,
    holds INTEGER,
    cranes INTEGER,
    gt_estimate NUMERIC NOT NULL,
    hire_rate_usd_per_day NUMERIC NOT NULL,
    demurrage_rate_usd_per_day NUMERIC NOT NULL,
    tpc_t_per_cm NUMERIC,
    series_premium NUMERIC,
    freight_index_class TEXT,
    rate_data_confidence TEXT NOT NULL,
    dimension_data_confidence TEXT NOT NULL,
    crane_swl_t NUMERIC,
    hatch_cover_type TEXT,
    block_coefficient NUMERIC,
    fuel_sea_t_per_day NUMERIC,
    fuel_port_t_per_day NUMERIC,
    design_data_confidence TEXT
);

CREATE TABLE IF NOT EXISTS plants (
    plant_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    monthly_coking_coal_demand_tonnes NUMERIC NOT NULL,
    current_inventory_tonnes NUMERIC NOT NULL,
    buffer_days_target NUMERIC NOT NULL,
    data_confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_assumptions (
    parameter TEXT PRIMARY KEY,
    value NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    notes TEXT,
    data_confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS port_to_plant_rail (
    port TEXT NOT NULL REFERENCES ports(name),
    plant TEXT NOT NULL REFERENCES plants(name),
    rail_distance_km NUMERIC,
    rail_cost_usd_per_tonne NUMERIC NOT NULL,
    rail_transit_days NUMERIC NOT NULL,
    data_confidence TEXT NOT NULL,
    PRIMARY KEY (port, plant)
);

CREATE TABLE IF NOT EXISTS origin_transit_days (
    origin TEXT PRIMARY KEY,
    transit_days_est NUMERIC NOT NULL,
    transit_nm_est NUMERIC,
    notes TEXT,
    data_confidence TEXT NOT NULL,
    load_port TEXT,
    load_max_draft_m NUMERIC,
    load_max_loa_m NUMERIC,
    load_max_beam_m NUMERIC,
    load_max_dwt NUMERIC,
    load_rate_tpd NUMERIC,
    activity_port TEXT,
    load_notes TEXT,
    load_data_confidence TEXT,
    coal_grades TEXT,
    coal_grades_source TEXT
);

-- Weekly time-charter rates, one series per market class (data/freight_rates_<class>.csv).
CREATE TABLE IF NOT EXISTS freight_rates (
    vessel_class TEXT NOT NULL,
    date DATE NOT NULL,
    freight_usd_per_day NUMERIC NOT NULL,
    data_confidence TEXT NOT NULL,
    PRIMARY KEY (vessel_class, date)
);

-- Real IMF PortWatch pulls (see src/live_weather.py's sibling data pulls in
-- data/imf_portwatch_*.csv) - a table to eventually land in, once this
-- becomes a scheduled ingestion rather than a one-off research pull.
CREATE TABLE IF NOT EXISTS port_daily_activity (
    port_name TEXT NOT NULL,
    date DATE NOT NULL,
    portcalls_dry_bulk INTEGER,
    import_dry_bulk NUMERIC,
    export_dry_bulk NUMERIC,
    PRIMARY KEY (port_name, date)
);

-- Mirrors data/gangavaram_real_tariff_reference.csv - one row per GT-tier
-- per charge type (see src/cost_engine.py's gangavaram_real_port_charges).
-- gt_band_min/max are nullable (an unbounded band), so they can't be part
-- of the primary key directly (Postgres PK columns are implicitly NOT
-- NULL) - a surrogate id is the primary key instead.
CREATE TABLE IF NOT EXISTS gangavaram_tariff_reference (
    id SERIAL PRIMARY KEY,
    charge_type TEXT NOT NULL,
    gt_band_min NUMERIC,
    gt_band_max NUMERIC,
    rate NUMERIC,
    unit TEXT,
    minimum_charge TEXT,
    notes TEXT,
    data_confidence TEXT NOT NULL
);
