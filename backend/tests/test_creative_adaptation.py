"""No-cost regression checks for cross-business creative adaptation."""
import unittest

from app.services.creative_adaptation import creative_context, relevant_lessons, scene_structure


SCENES = [
    {"start_seconds": 0, "end_seconds": 2, "purpose": "hook", "mechanism": "curiosity"},
    {"start_seconds": 2, "end_seconds": 6, "purpose": "demonstration", "mechanism": "contrast"},
]


class CreativeAdaptationTests(unittest.TestCase):
    def test_scene_structure(self):
        beats = scene_structure(SCENES)
        self.assertEqual(len(beats), 2)
        self.assertEqual(beats[1].mechanism, "contrast")

    def test_overlap_rejected(self):
        with self.assertRaises(ValueError):
            scene_structure(SCENES + [{"start_seconds": 5, "end_seconds": 8}])

    def test_bad_duration_rejected(self):
        with self.assertRaises(ValueError):
            scene_structure([{"start_seconds": 2, "end_seconds": 1}])

    def test_relevant_accepted_lessons_only(self):
        lessons = [
            {"status": "accepted", "relevant_to_target": True, "recommendation": "Shorter hook"},
            {"status": "accepted", "relevant_to_target": False, "recommendation": "Food packaging"},
            {"status": "dismissed", "relevant_to_target": True, "recommendation": "Do not use"},
        ]
        self.assertEqual(relevant_lessons(lessons), ("Shorter hook",))
        text = creative_context(task="script", source_business="Food brand",
                                target_business="Tile installer", topic="tile care",
                                audience="homeowners", objective="enquiries",
                                scenes=SCENES, lessons=lessons)
        self.assertIn("Tile installer", text)
        self.assertIn("Shorter hook", text)
        self.assertNotIn("Food packaging", text)
        self.assertIn("NOT measured outcomes", text)

    def test_target_required(self):
        with self.assertRaises(ValueError):
            creative_context(task="hook", source_business="A", target_business="",
                             topic="", audience="", objective="", scenes=SCENES)

    def test_unsupported_task_rejected(self):
        with self.assertRaises(ValueError):
            creative_context(task="thumbnail", source_business="A", target_business="B",
                             topic="", audience="", objective="", scenes=SCENES)


if __name__ == "__main__":
    unittest.main()
