"""Download only the source and manifest assigned to this pipeline run."""
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Kumo source endpoints must not redirect")


def main():
    build_id = str(uuid.UUID(os.environ["KUMO_BUILD_ID"]))
    api_url = os.environ["KUMO_API_URL"].rstrip("/")
    parsed = urllib.parse.urlsplit(api_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("kumoApiUrl must be an HTTPS API URL")
    token = os.environ["KUMO_SOURCE_TOKEN"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise RuntimeError("Missing or invalid build source credential")
    directory = Path(os.environ["KUMO_BUILD_DIRECTORY"])
    directory.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(NoRedirect())

    def request(endpoint):
        return opener.open(urllib.request.Request(
            f"{api_url}/builds/{build_id}/{endpoint}",
            headers={"Authorization": f"Bearer {token}"},
        ), timeout=180)

    with request("manifest") as response:
        manifest = json.loads(response.read(65537))
    image = manifest["image"]
    dockerfile = manifest["dockerfile_path"]
    if not isinstance(image, str) or not image.endswith(f":{build_id}") or not re.fullmatch(r"[a-zA-Z0-9.-]+/kumo/[0-9]+/[a-z0-9]+(?:[._-][a-z0-9]+)*:[a-f0-9-]{36}", image):
        raise RuntimeError("Invalid build image in manifest")
    if not isinstance(dockerfile, str) or not dockerfile or dockerfile.startswith("/") or ".." in dockerfile.split("/") or "\\" in dockerfile or ":" in dockerfile:
        raise RuntimeError("Invalid Dockerfile path in manifest")
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with request("source") as response, (directory / "source.tar.gz").open("wb") as output:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 256 * 1024 * 1024:
                raise RuntimeError("Build archive exceeds download limit")
            output.write(chunk)
    print("Downloaded source for the assigned build")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        print(f"Source download failed: HTTP {error.code}", file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Avoid printing exception URLs, which can contain credentials.
        print("Source download failed; check pipeline variables and Kumo availability", file=sys.stderr)
        sys.exit(1)
