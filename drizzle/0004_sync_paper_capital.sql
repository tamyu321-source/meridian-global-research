-- Reconcile capital values saved before existing portfolios were updated by the settings API.
-- Currency changes and reductions that would create negative cash are intentionally skipped.
UPDATE `paper_portfolios`
SET
  `cash` = `cash` + ((SELECT `paper_capital` FROM `user_settings` WHERE `user_settings`.`user_email` = `paper_portfolios`.`user_email`) - `starting_capital`),
  `high_watermark` = MAX(
    (SELECT `paper_capital` FROM `user_settings` WHERE `user_settings`.`user_email` = `paper_portfolios`.`user_email`),
    `high_watermark` + ((SELECT `paper_capital` FROM `user_settings` WHERE `user_settings`.`user_email` = `paper_portfolios`.`user_email`) - `starting_capital`)
  ),
  `starting_capital` = (SELECT `paper_capital` FROM `user_settings` WHERE `user_settings`.`user_email` = `paper_portfolios`.`user_email`),
  `risk_plan` = COALESCE((SELECT `risk_plan` FROM `user_settings` WHERE `user_settings`.`user_email` = `paper_portfolios`.`user_email`), `risk_plan`),
  `updated_at` = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM `user_settings`
  WHERE `user_settings`.`user_email` = `paper_portfolios`.`user_email`
    AND `user_settings`.`paper_capital` > 0
    AND `user_settings`.`base_currency` = `paper_portfolios`.`base_currency`
    AND `user_settings`.`paper_capital` <> `paper_portfolios`.`starting_capital`
    AND `paper_portfolios`.`cash` + (`user_settings`.`paper_capital` - `paper_portfolios`.`starting_capital`) >= 0
);
