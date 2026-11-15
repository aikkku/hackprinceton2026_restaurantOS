"""Local-only deployment decision/failure tests: no Docker, GitHub or Atlas calls."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('autodeploy', Path(__file__).with_name('autodeploy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = 'a' * 40
OLD = 'b' * 40


def workflow(**overrides):
    return {'id': 1, 'run_attempt': 1, 'head_sha': SHA, 'head_branch': 'main',
            'event': 'push', 'head_repository': {'full_name': module.REPO},
            'status': 'completed', 'conclusion': 'success', **overrides}


class VerificationTests(unittest.TestCase):
    def test_requires_exact_main_push_and_repository(self):
        self.assertTrue(module.verified([workflow()], SHA))
        for override in [dict(head_sha=OLD), dict(event='pull_request'),
                         dict(head_branch='feature'), dict(head_repository={'full_name': 'fork/repo'}),
                         dict(status='in_progress'), dict(conclusion='failure'), dict(conclusion='cancelled')]:
            with self.subTest(override=override):
                self.assertFalse(module.verified([workflow(**override)], SHA))
        self.assertFalse(module.verified([], SHA))

    def test_newer_failed_or_pending_run_overrides_older_success(self):
        self.assertFalse(module.verified([workflow(), workflow(id=2, conclusion='failure')], SHA))
        self.assertFalse(module.verified([workflow(), workflow(run_attempt=2, status='in_progress')], SHA))


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.deployer = module.Deployer({'state': self.temp.name})
        self.deployer.write('current.json', OLD)
        self.calls = []
        for name, result in [('latest', SHA), ('passed', True), ('build', None),
                             ('backup', None), ('activate', None)]:
            mock = self.enterContext(patch.object(self.deployer, name, return_value=result))
            setattr(self, name, mock)

    def test_verified_release_advances_only_after_healthy_activation(self):
        self.deployer.deploy()
        self.build.assert_called_once_with(SHA)
        self.backup.assert_called_once()
        self.activate.assert_called_once_with(SHA)
        self.assertEqual(self.deployer.read('current.json'), SHA)
        self.assertIsNone(self.deployer.read('pending.json'))

    def test_waits_without_touching_app_when_ci_is_not_successful(self):
        self.passed.return_value = False
        self.deployer.deploy()
        self.build.assert_not_called()
        self.activate.assert_not_called()

    def test_github_outage_keeps_running_app(self):
        self.passed.side_effect = OSError('GitHub unavailable')
        with self.assertRaises(OSError):
            self.deployer.deploy()
        self.activate.assert_not_called()
        self.assertEqual(self.deployer.read('current.json'), OLD)

    def test_build_failure_does_not_replace_app_or_repeat_until_retry(self):
        self.build.side_effect = subprocess.CalledProcessError(1, 'docker build')
        with self.assertRaises(subprocess.CalledProcessError):
            self.deployer.deploy()
        self.activate.assert_not_called()
        self.assertEqual(self.deployer.read('failed.json'), SHA)
        self.build.reset_mock(side_effect=True)
        self.deployer.deploy()
        self.build.assert_not_called()
        self.deployer.deploy(retry=True)
        self.assertEqual(self.deployer.read('current.json'), SHA)

    def test_new_push_during_build_prevents_stale_release(self):
        self.latest.side_effect = [SHA, 'c' * 40]
        self.deployer.deploy()
        self.build.assert_called_once()
        self.activate.assert_not_called()
        self.assertEqual(self.deployer.read('current.json'), OLD)

    def test_ci_rerun_during_build_prevents_activation(self):
        self.passed.side_effect = [True, False]
        self.deployer.deploy()
        self.activate.assert_not_called()

    def test_failed_health_check_restores_previous_image_and_state(self):
        self.activate.side_effect = [subprocess.CalledProcessError(1, 'up'), None]
        with self.assertRaises(subprocess.CalledProcessError):
            self.deployer.deploy()
        self.assertEqual([c.args[0] for c in self.activate.call_args_list], [SHA, 'rollback'])
        self.assertEqual(self.deployer.read('current.json'), OLD)
        self.assertEqual(self.deployer.read('failed.json'), SHA)
        self.assertIsNone(self.deployer.read('pending.json'))

    def test_reboot_during_activation_recovers_before_considering_new_work(self):
        self.deployer.write('pending.json', {'target': SHA, 'previous': OLD})
        self.deployer.deploy()
        self.activate.assert_called_once_with('rollback')
        self.build.assert_not_called()
        self.assertEqual(self.deployer.read('current.json'), OLD)

    def test_failed_rollback_retains_recovery_record(self):
        self.activate.side_effect = subprocess.CalledProcessError(1, 'up')
        with self.assertRaises(subprocess.CalledProcessError):
            self.deployer.deploy()
        self.assertEqual(self.deployer.read('pending.json')['target'], SHA)
        self.assertEqual(self.deployer.read('current.json'), OLD)

    def test_same_commit_does_not_call_github_or_build(self):
        self.latest.return_value = OLD
        self.deployer.deploy()
        self.passed.assert_not_called()
        self.build.assert_not_called()


if __name__ == '__main__':
    unittest.main()
