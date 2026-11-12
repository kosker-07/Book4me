-- PR-C: Register disabled platform agents. Safe to apply repeatedly.
INSERT INTO ai_agents (id, name, function_name, model, enabled, daily_token_budget) VALUES
('owner-assistant','Owner Assistant','owner','claude-sonnet-4-5',false,200000),
('reservations','Reservations Agent','reservations','claude-sonnet-4-5',false,200000),
('accounting','Accounting Agent','accounting','claude-sonnet-4-5',false,200000),
('contracts','Contracts Agent','contracts','claude-sonnet-4-5',false,200000),
('support','Support Agent','support','claude-sonnet-4-5',false,200000),
('pricing','Pricing & Profit Agent','pricing','claude-sonnet-4-5',false,200000),
('operations','Operations Agent','operations','claude-sonnet-4-5',false,200000),
('integrations','Integrations Agent','integrations','claude-sonnet-4-5',false,200000)
ON CONFLICT (id) DO NOTHING;
