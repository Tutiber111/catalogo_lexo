update public.product_overrides
set
  sku = '3041',
  name = 'Pinza para asados 23cm.',
  category = 'Pinzas',
  price = '$13.741',
  updated_at = now()
where product_id = 'p190-1';

update public.product_overrides
set
  sku = 'P3041',
  name = 'Frasco EVAK 11,8 x 13 cm',
  category = 'Frascos EVAK',
  price = '$10.277',
  updated_at = now()
where product_id = 'prepara-p386-3';
