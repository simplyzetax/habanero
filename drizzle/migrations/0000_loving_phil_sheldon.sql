CREATE TABLE `hotfixes` (
	`id` text PRIMARY KEY NOT NULL,
	`unique_filename` text NOT NULL,
	`filename` text NOT NULL,
	`hash` text NOT NULL,
	`hash256` text NOT NULL,
	`length` integer NOT NULL,
	`contents` text NOT NULL,
	`scraped_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hotfixes_unique_filename` ON `hotfixes` (`unique_filename`);--> statement-breakpoint
CREATE INDEX `idx_hotfixes_filename` ON `hotfixes` (`filename`);--> statement-breakpoint
CREATE INDEX `idx_hotfixes_scraped_at` ON `hotfixes` (`scraped_at`);--> statement-breakpoint
CREATE INDEX `idx_hotfixes_contents` ON `hotfixes` (`contents`);