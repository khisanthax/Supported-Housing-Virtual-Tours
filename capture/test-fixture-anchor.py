"""Synthetic regression tests for fixture-anchor-probe.py. Run with python capture/test-fixture-anchor.py."""

import runpy
import unittest
from pathlib import Path

import cv2 as cv
import numpy as np
from scipy.spatial.transform import Rotation

probe = runpy.run_path(str(Path(__file__).with_name("fixture-anchor-probe.py")))


class FixtureAnchorTest(unittest.TestCase):
    def setUp(self):
        self.width, self.height = 192, 144
        self.identity = np.eye(3)
        self.k = np.array([[150.0, 0.0, 95.5], [0.0, 150.0, 71.5], [0.0, 0.0, 1.0]])
        self.panel = np.zeros((self.height, self.width, 3), np.uint8)
        # Clipping one end leaves exactly one identifiable end cap.
        cv.rectangle(self.panel, (0, 55), (135, 76), (250, 250, 250), -1)
        self.cap = np.array([[135.0, 55.0], [135.0, 76.0]])
        self.far = np.array([[0.0, 55.0], [0.0, 76.0]])

    def options(self, ref):
        return probe["anchor_candidate"](self.panel, ref, self.k, self.k, self.identity)

    def test_unique_endcap_recovers_known_rotation(self):
        rotation = Rotation.from_euler("y", -4, degrees=True).as_matrix()
        matrix = self.k @ rotation @ np.linalg.inv(self.k)
        reference = cv.warpPerspective(
            self.panel, matrix, (self.width, self.height), flags=cv.INTER_NEAREST
        )
        candidates = self.options(reference)
        self.assertEqual(len(candidates), 1)
        _, recovered, *_ = candidates[0]
        # Judge image-space agreement at known endpoints, including rasterization.
        predicted = probe["project"](
            self.cap, self.k @ recovered @ np.linalg.inv(self.k)
        )
        expected = probe["project"](self.cap, matrix)
        self.assertLess(np.max(np.linalg.norm(expected - predicted, axis=1)), 1.5)

    def test_blank_image_cannot_support_endcap(self):
        self.assertEqual(self.options(np.zeros_like(self.panel)), [])

    def test_profile_does_not_count_missing_photo_pixels_as_dark_edges(self):
        offsets = np.arange(-20, 21)
        xy = np.stack([50 + offsets, np.full_like(offsets, 50)], axis=1)
        image = np.zeros_like(self.panel)
        image[50, 45:61] = 255
        support = np.full(image.shape[:2], 255, np.uint8)
        np.testing.assert_array_equal(
            probe["profile_edges"](image, support, xy, offsets), [-5, 10]
        )
        support[:, :45] = 0
        self.assertIsNone(probe["profile_edges"](image, support, xy, offsets))

    def test_repeated_bright_panel_gives_ambiguous_options(self):
        ref = self.panel.copy()
        cv.rectangle(ref, (0, 85), (135, 106), (250, 250, 250), -1)
        self.assertGreater(len(self.options(ref)), 1)

    def test_identity_mesh_preserves_every_pixel(self):
        image = np.random.default_rng(777).integers(
            0, 256, self.panel.shape, dtype=np.uint8
        )
        for rails in (None, (self.identity, self.identity, self.cap, self.far)):
            with self.subTest(using_rails=rails is not None):
                output, metrics = probe["mesh"](
                    image, self.identity, self.cap, self.far, rails
                )
                np.testing.assert_array_equal(image, output)
                self.assertAlmostEqual(metrics["minAreaRatio"], 1.0)
                self.assertAlmostEqual(metrics["maxAreaRatio"], 1.0)

    def test_reflected_fixture_cannot_fold_mesh(self):
        reflected = np.array(
            [[-1.0, 0.0, self.width - 1], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        )
        with self.assertRaisesRegex(ValueError, "fold"):
            probe["mesh"](self.panel, reflected, self.cap, self.far)

    def test_control_points_outside_shared_support_are_rejected(self):
        displaced = np.array(
            [[1.0, 0.0, 2 * self.width], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        )
        with self.assertRaisesRegex(ValueError, "visible control points"):
            probe["mesh"](self.panel, displaced, self.cap, self.far)
        rails = (self.identity, displaced, self.cap, self.far)
        with self.assertRaisesRegex(ValueError, "outside shared support"):
            probe["mesh"](self.panel, displaced, self.cap, self.far, rails)


if __name__ == "__main__":
    unittest.main(verbosity=2)
