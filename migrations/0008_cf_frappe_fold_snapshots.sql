CREATE TABLE IF NOT EXISTS cf_frappe_fold_snapshots (
  stream TEXT NOT NULL,
  fold_name TEXT NOT NULL,
  fold_version INTEGER NOT NULL,
  upto_sequence INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (stream, fold_name, fold_version)
);
