"""Download only the source and manifest assigned to this pipeline run."""
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


class DownloadError(Exception):
    """A diagnostic authored by this script, safe to show in pipeline logs."""


def required_environment(name):
    value = os.environ.get(name, "").strip()
    if not value or value.startswith("$("):
        raise DownloadError(f"Missing pipeline environment variable: {name}")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DownloadError("Kumo endpoint redirected; configure kumoApiUrl with the final API URL")


def validate_manifest(manifest, build_id):
    if not isinstance(manifest, dict) or "image" not in manifest or "dockerfile_path" not in manifest:
        raise DownloadError("Manifest is missing image or dockerfile_path; check the API URL and deployed API version")
    if manifest.get("build_id") != build_id:
        raise DownloadError("Manifest does not belong to the assigned build")
    image = manifest["image"]
    dockerfile = manifest["dockerfile_path"]
    if not isinstance(image, str) or not re.fullmatch(r"[a-zA-Z0-9.-]+/[a-z0-9]+(?:[._-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", image):
        raise DownloadError("Invalid build image in manifest")
    if not isinstance(dockerfile, str) or not dockerfile or dockerfile.startswith("/") or ".." in dockerfile.split("/") or "\\" in dockerfile or ":" in dockerfile:
        raise DownloadError("Invalid Dockerfile path in manifest")


def main():
    try:
        build_id = str(uuid.UUID(required_environment("KUMO_BUILD_ID")))
    except ValueError:
        raise DownloadError("buildId must be the UUID assigned by Kumo") from None
    api_url = required_environment("KUMO_API_URL").rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(api_url)
    except ValueError:
        raise DownloadError("kumoApiUrl is not a valid URL") from None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise DownloadError("kumoApiUrl must be an HTTPS API URL without credentials, query, or fragment")
    if parsed.hostname.lower() in ("localhost", "127.0.0.1", "::1"):
        raise DownloadError("kumoApiUrl points to localhost; hosted agents need a public HTTPS API or tunnel")
    print(f"Build source downloader v2: API host {parsed.hostname}; assigned build {build_id}", flush=True)
    token = required_environment("KUMO_SOURCE_TOKEN")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise DownloadError("Invalid kumoSourceToken; start a new build through Kumo to supply its per-build credential")
    directory = Path(required_environment("KUMO_BUILD_DIRECTORY"))
    directory.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(NoRedirect())

    def request(endpoint):
        print(f"Requesting build {endpoint}", flush=True)
        try:
            return opener.open(urllib.request.Request(
                f"{api_url}/builds/{build_id}/{endpoint}",
                headers={"Authorization": f"Bearer {token}"},
            ), timeout=180)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise DownloadError(
                    f"{endpoint} request failed: HTTP 404; verify kumoApiUrl, the tunnel's forwarded API port, "
                    "and the deployed /builds routes"
                ) from None
            raise DownloadError(f"{endpoint} request failed: HTTP {error.code}") from None
        except urllib.error.URLError as error:
            if isinstance(error.reason, socket.gaierror):
                reason = "DNS lookup failed; check kumoApiUrl hostname"
            elif isinstance(error.reason, ssl.SSLError):
                reason = "TLS validation failed; use a trusted HTTPS certificate"
            elif isinstance(error.reason, (TimeoutError, socket.timeout)):
                reason = "connection timed out; check API availability and network access"
            elif isinstance(error.reason, ConnectionRefusedError):
                reason = "connection refused; check the API host and port"
            else:
                reason = "network connection failed; hosted agents must reach the API"
            raise DownloadError(f"{endpoint} request failed: {reason}") from None

    with request("manifest") as response:
        try:
            manifest = json.loads(response.read(65537))
        except (ValueError, UnicodeError):
            raise DownloadError("Manifest is not valid JSON; check the API URL, route prefix, and tunnel interstitial pages") from None
    validate_manifest(manifest, build_id)
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with request("source") as response, (directory / "source.tar.gz").open("wb") as output:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 256 * 1024 * 1024:
                raise DownloadError("Build archive exceeds download limit")
            output.write(chunk)
    print("Downloaded source for the assigned build")


if __name__ == "__main__":
    try:
        main()
    except DownloadError as error:
        print(f"Source download failed: {error}", file=sys.stderr)
        sys.exit(1)
    except TimeoutError:
        print("Source download failed: request or archive transfer timed out", file=sys.stderr)
        sys.exit(1)
    except OSError:
        print("Source download failed: network transfer or local file operation failed", file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Avoid printing exception URLs, which can contain credentials.
        print("Source download failed; check pipeline variables and Kumo availability", file=sys.stderr)
        sys.exit(1)
