import urllib.error
import unittest
from unittest.mock import patch

from bridge.signed_request import signed_json


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b'{"accepted":true}'


class SignedRequestTests(unittest.TestCase):
    def test_retryable_server_error_reuses_idempotency_key(self):
        transient = urllib.error.HTTPError("https://example.test", 500, "temporary", {}, None)
        with patch("bridge.signed_request.urllib.request.urlopen", side_effect=[transient, _Response()]) as open_url, patch("bridge.signed_request.time.sleep") as sleep:
            result = signed_json("https://example.test", "secret", {"value": 1}, "stable-key", attempts=2)
        self.assertEqual(result, {"accepted": True})
        self.assertEqual(open_url.call_count, 2)
        self.assertEqual(open_url.call_args_list[0].args[0].get_header("X-idempotency-key"), "stable-key")
        self.assertEqual(open_url.call_args_list[1].args[0].get_header("X-idempotency-key"), "stable-key")
        sleep.assert_called_once()

    def test_non_retryable_auth_error_fails_immediately(self):
        unauthorized = urllib.error.HTTPError("https://example.test", 401, "unauthorized", {}, None)
        with patch("bridge.signed_request.urllib.request.urlopen", side_effect=unauthorized) as open_url, patch("bridge.signed_request.time.sleep") as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                signed_json("https://example.test", "secret", {}, "key")
        self.assertEqual(open_url.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
