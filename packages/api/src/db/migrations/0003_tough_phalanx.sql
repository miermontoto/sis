CREATE TABLE `generated_playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`spotify_playlist_id` text,
	`name` text NOT NULL,
	`strategy` text NOT NULL,
	`params` text NOT NULL,
	`track_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_generated_playlists_user_id` ON `generated_playlists` (`user_id`);--> statement-breakpoint
CREATE TABLE `generated_playlist_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `generated_playlists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`spotify_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_gpt_playlist_id` ON `generated_playlist_tracks` (`playlist_id`);
