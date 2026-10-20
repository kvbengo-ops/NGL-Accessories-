UPDATE storage.buckets
SET file_size_limit = 2621440 -- 2.5 MB
WHERE id = 'try-on-assets';
