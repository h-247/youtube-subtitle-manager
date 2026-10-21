CREATE TABLE hosted_job_leases (
  user_id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL
);
ALTER TABLE videos ADD COLUMN drive_upload_id TEXT;
CREATE UNIQUE INDEX uq_video_drive_upload ON videos(drive_upload_id);
