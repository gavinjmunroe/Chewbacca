# The bucket has to let the browser talk to it

## What breaks without this

Uploading a file shows **"Failed to fetch"** and nothing reaches the drive.

That string is not ours. It is the browser's, and it means the PUT to Google
Cloud Storage was refused before it left — so there is no status code, no
response body, and nothing in the API logs, because the request never came
anywhere near the API.

## Why

An upload here is three steps, deliberately:

1. the browser asks amber-id for a signed URL
2. **the browser PUTs the bytes straight to GCS**
3. the browser asks amber-id to verify and read the file

Step 2 never touches our server — which is the point, since a 100MB deck
should not occupy a request worker for the length of somebody's hotel wifi.
But it does mean the browser is making a cross-origin request to
`storage.googleapis.com`, and a bucket with no CORS policy refuses every one
of those before the first byte moves.

## Fix

Once per bucket. Note the `railway run`: the bucket name lives in Railway, not
in your shell, so running this without it expands `$GCS_NOTE_AUDIO_BUCKET` to
nothing and gcloud complains that `gs://` is not a bucket URL.

```sh
railway run bash -c 'gcloud storage buckets update gs://$GCS_NOTE_AUDIO_BUCKET --cors-file=infra/gcs-cors.json'
```

Check it took:

```sh
railway run bash -c 'gcloud storage buckets describe gs://$GCS_NOTE_AUDIO_BUCKET --format="value(cors_config)"'
```

`railway run` injects the service's variables into a command that still runs on
your machine, so your own gcloud credentials are what authenticate. If your
gcloud is logged into a different project than the bucket, add
`--project=<the bucket's project>`.

If you would rather not involve Railway, read the name once and paste it:

```sh
railway variables | grep GCS_NOTE_AUDIO_BUCKET
gcloud storage buckets update gs://THE-NAME --cors-file=infra/gcs-cors.json
```

## Notes

- `PUT` is the upload. `GET` and `HEAD` are there because the server verifies
  the object and signs short-lived download URLs, and a browser following one
  of those is also a cross-origin read.
- The origins are an allowlist, and it is the same list as `AMBER_WEB_ORIGINS`.
  Adding a domain to one without the other produces exactly this failure on
  that domain alone, which is a confusing afternoon — so they are listed
  together here on purpose.
- This grants nothing. CORS decides which origins may make the request; the
  signed URL still decides whether it is allowed to succeed, and it expires in
  fifteen minutes.
