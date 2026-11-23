import json
import sys
import uuid

import pytest

from reposhift import cli


@pytest.mark.parametrize("option,expected", [([], "C"), (["--configuration", "A"], "A")])
def test_submit_passes_configuration_to_store(monkeypatch, capsys, option, expected):
    submitted = []
    run_id = uuid.uuid4()

    class FakeStore:
        def init(self):
            pass

        def submit(self, data, key):
            submitted.append(data)
            return {"id": run_id, "state": "QUEUED"}

    monkeypatch.setattr(cli, "Store", FakeStore)
    monkeypatch.setattr(sys, "argv", ["reposhift", "submit", "sdk-options", *option])
    cli.main()
    assert submitted == [{"recipe": "sdk-options", "provider": "reference", "configuration": expected}]
    assert json.loads(capsys.readouterr().out) == {"id": str(run_id), "state": "QUEUED"}
