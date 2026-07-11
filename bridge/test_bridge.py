import unittest
from bridge.meridian_bridge import _at, _number


class BridgeUnitTests(unittest.TestCase):
    def test_number_rejects_missing_and_nan(self):
        self.assertEqual(_number(None), 0)
        self.assertEqual(_number("nan"), 0)
        self.assertEqual(_number("12.5"), 12.5)

    def test_at_handles_sparse_provider_arrays(self):
        self.assertEqual(_at([1, None, 3], 1), 0)
        self.assertEqual(_at([1, 2, 3], 2), 3)


if __name__ == "__main__":
    unittest.main()
