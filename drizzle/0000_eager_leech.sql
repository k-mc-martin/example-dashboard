CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`received_at` text NOT NULL,
	`category` text NOT NULL,
	`support_kind` text,
	`source_url` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_received_at` ON `messages` (`received_at`);