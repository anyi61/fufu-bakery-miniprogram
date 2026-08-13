CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity_created` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`product_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`product_subtitle` text NOT NULL,
	`image_url` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_total_cents` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`display_number` text NOT NULL,
	`pickup_code_hash` text NOT NULL,
	`pickup_code_display` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone_masked` text NOT NULL,
	`customer_user_id` text NOT NULL,
	`slot_id` integer NOT NULL,
	`status` text NOT NULL,
	`payment_status` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`package_fee_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`adapter_mode` text DEFAULT 'demo' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`slot_id`) REFERENCES `pickup_slots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_idempotency_key` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_orders_customer_created` ON `orders` (`customer_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_status_slot` ON `orders` (`status`,`slot_id`);--> statement-breakpoint
CREATE TABLE `pickup_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`capacity` integer NOT NULL,
	`reserved_count` integer DEFAULT 0 NOT NULL,
	`paid_count` integer DEFAULT 0 NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pickup_slots_date_start` ON `pickup_slots` (`business_date`,`starts_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subtitle` text NOT NULL,
	`category` text NOT NULL,
	`price_cents` integer NOT NULL,
	`planned_stock` integer NOT NULL,
	`sold_stock` integer DEFAULT 0 NOT NULL,
	`reserved_stock` integer DEFAULT 0 NOT NULL,
	`is_sold_out` integer DEFAULT false NOT NULL,
	`tag` text,
	`image_url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_products_category_sort` ON `products` (`category`,`sort_order`);