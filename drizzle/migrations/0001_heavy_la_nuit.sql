ALTER TABLE `hotfixes` ADD `version` text DEFAULT 'unknown';--> statement-breakpoint
CREATE INDEX `idx_hotfixes_version` ON `hotfixes` (`version`);