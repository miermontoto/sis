CREATE TABLE IF NOT EXISTS `follows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`follower_id` integer NOT NULL,
	`followed_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`followed_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_follows_pair` ON `follows` (`follower_id`,`followed_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_follows_follower` ON `follows` (`follower_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_follows_followed` ON `follows` (`followed_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `share_links` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`range` text,
	`label` text,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`last_accessed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_share_links_user` ON `share_links` (`user_id`);
