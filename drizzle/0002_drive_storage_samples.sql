CREATE TABLE `drive_storage_samples` (
	`observed_at` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`limit_bytes` text,
	`used_bytes` text,
	`drive_bytes` text,
	`trash_bytes` text,
	`error_code` text,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_drive_storage_received_at` ON `drive_storage_samples` (`received_at`);
