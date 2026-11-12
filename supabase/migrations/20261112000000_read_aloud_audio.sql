-- Read-aloud audio for look notes lives beside the photos, in the same private bucket.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'audio/mpeg')
where id = 'photos' and not ('audio/mpeg' = any(allowed_mime_types));
