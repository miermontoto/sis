CREATE TABLE `spotify_playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`spotify_id` text NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`owner_name` text,
	`is_owned` integer DEFAULT false,
	`is_algorithmic` integer DEFAULT false,
	`track_count` integer DEFAULT 0,
	`snapshot_id` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spotify_playlists_user_spotify` ON `spotify_playlists` (`user_id`,`spotify_id`);--> statement-breakpoint
CREATE TABLE `spotify_playlist_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` text,
	FOREIGN KEY (`playlist_id`) REFERENCES `spotify_playlists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`spotify_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_spt_playlist_id` ON `spotify_playlist_tracks` (`playlist_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spt_playlist_track` ON `spotify_playlist_tracks` (`playlist_id`,`track_id`);
