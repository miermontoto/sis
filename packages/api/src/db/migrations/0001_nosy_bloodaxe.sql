CREATE TABLE IF NOT EXISTS `merge_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` text NOT NULL
);