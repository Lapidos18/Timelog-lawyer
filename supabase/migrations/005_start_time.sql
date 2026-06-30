-- Добавляем время начала записи для корректного отображения на временной шкале
alter table time_entries add column if not exists start_time time default '09:00';
