CREATE TABLE `provider_connections` (
	`provider` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`identity_json` text NOT NULL,
	`checked_at` text NOT NULL,
	`updated_at` text NOT NULL
);
