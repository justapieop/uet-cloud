import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "download_build_source", Path(__file__).with_name("download-build-source.py")
)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class ManifestValidationTests(unittest.TestCase):
    def setUp(self):
        self.build_id = "00000000-0000-4000-8000-000000000001"
        self.manifest = {
            "build_id": self.build_id,
            "image": "registry.azurecr.io/my-app:Release_1.2.3",
            "dockerfile_path": "docker/Dockerfile",
        }

    def test_accepts_requested_tag_independently_of_tracking_id(self):
        source.validate_manifest(self.manifest, self.build_id)

    def test_rejects_a_manifest_for_a_different_build(self):
        with self.assertRaisesRegex(source.DownloadError, "assigned build"):
            source.validate_manifest(self.manifest, "another-build")

    def test_rejects_a_manifest_without_tracking_identity(self):
        del self.manifest["build_id"]
        with self.assertRaisesRegex(source.DownloadError, "assigned build"):
            source.validate_manifest(self.manifest, self.build_id)

    def test_rejects_invalid_image_tags_and_names(self):
        for image in (
            "registry.azurecr.io/my-app:bad tag",
            "registry.azurecr.io/my-app:",
            "registry.azurecr.io/my-app:bad/tag",
            "registry.azurecr.io/my-app:" + "a" * 129,
            "registry.azurecr.io/kumo/123/my-app:v1",
        ):
            with self.subTest(image=image), self.assertRaisesRegex(source.DownloadError, "Invalid build image"):
                source.validate_manifest({**self.manifest, "image": image}, self.build_id)

    def test_rejects_escaping_dockerfile_paths(self):
        with self.assertRaisesRegex(source.DownloadError, "Invalid Dockerfile path"):
            source.validate_manifest({**self.manifest, "dockerfile_path": "../Dockerfile"}, self.build_id)


if __name__ == "__main__":
    unittest.main()
