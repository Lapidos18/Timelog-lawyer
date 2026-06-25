
UPDATE profiles 
SET full_name = 'Бухмин Антон Андреевич'
WHERE id = (SELECT id FROM auth.users WHERE email = 'anton.buhmin@gmail.com');
