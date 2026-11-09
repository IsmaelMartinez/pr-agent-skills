"""Run PR-Agent /review on a GitHub PR with an AI agent answering PR-Agent's prompt as the model.

capture: render the prompt PR-Agent would send and save it with a meta.json binding it to the PR head.
preview: replay the saved answer through PR-Agent's parser and renderer; write the comment to preview.md.
publish: replay the same answer with publishing on. Refuses unless a preview of the same answer and signature
         succeeded, the PR head and the rendered prompt are unchanged, and the comment about to be sent matches
         the preview.

Usage: local_review.py capture|preview|publish <pr_url> <workdir> [signature]
Exit status is non-zero whenever the requested phase did not complete.
"""
import asyncio
import hashlib
import json
import re
import sys
import time
from pathlib import Path

from pr_agent.agent import pr_agent as pr_agent_module
from pr_agent.agent.pr_agent import PRAgent
from pr_agent.algo.ai_handlers.base_ai_handler import BaseAiHandler
from pr_agent.config_loader import get_settings
from pr_agent.git_providers import utils as provider_utils

# Default model for token counting and limits only; the handler never calls it. A target repository that sets
# config.model overrides it, exactly as it would in a real run.
TOKEN_COUNT_MODEL = "anthropic/claude-sonnet-4-5-20250929"

# Applied right after the target repository's settings are loaded, so the run produces exactly one review comment
# and nothing the preview cannot show.
PINNED = {
    "CONFIG.PUBLISH_OUTPUT_PROGRESS": False,
    "PR_REVIEWER.ENABLE_REVIEW_LABELS_EFFORT": False,
    "PR_REVIEWER.ENABLE_REVIEW_LABELS_SECURITY": False,
    "PR_REVIEWER.INLINE_KEY_ISSUES": False,
    "PR_REVIEWER.PERSISTENT_COMMENT": True,
    "PR_REVIEWER.PERSISTENT_FINDING_STATE": True,
    "PR_REVIEWER.FINAL_UPDATE_MESSAGE": False,
    "PR_REVIEWER.PUBLISH_REVIEW_FAILURE_COMMENT": False,
    "PR_REVIEWER.PUBLISH_OUTPUT_NO_SUGGESTIONS": True,
    "PR_REVIEWER.ENABLE_LARGE_PR_CHUNKING": False,
    "GITHUB.PUBLISH_AS_CHECK_RUN": False,
    "PUSH_OUTPUTS.ENABLE": False,
}

NONCE = re.compile(r"<<<([A-Z_]{1,64})_[0-9a-f]{32}_(BEGIN|END)>>>")
UPDATE_HEADER = re.compile(r"^#### \(Review updated until commit [^\n]{0,500}\)$", re.MULTILINE)


class StopAfterCapture(Exception):
    pass


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def without_nonces(text: str) -> str:
    return NONCE.sub(r"<<<\1_\2>>>", text)


def strip_hidden(text: str) -> str:
    """Drop what publish adds and preview cannot show: HTML-comment markers and the in-place update header."""
    kept, i = [], 0
    while (start := text.find("<!--", i)) != -1:
        kept.append(text[i:start])
        end = text.find("-->", start + 4)
        i = len(text) if end == -1 else end + 3
    kept.append(text[i:])
    text = UPDATE_HEADER.sub("", "".join(kept))
    return "\n".join(line for line in text.splitlines() if line.strip())


def make_handler(mode: str, work: Path):
    class FileHandler(BaseAiHandler):
        calls = 0

        def __init__(self):
            pass

        @property
        def deployment_id(self):
            return None

        async def chat_completion(self, model, system, user, temperature=0.2, img_path=None):
            n = FileHandler.calls
            FileHandler.calls += 1
            if n > 0:
                raise RuntimeError("PR-Agent asked for a second model call; this script handles exactly one")
            messages = self.build_request_messages(model, system, user)
            system_text, user_text = messages[0]["content"], messages[1]["content"]
            if mode == "capture":
                (work / "prompt_0.json").write_text(json.dumps({"model": model, "system": system_text,
                                                                 "user": user_text}))
                # Plain-text copies so the answering agent can page them instead of printing a large JSON blob.
                (work / "prompt_0.system.txt").write_text(system_text)
                (work / "prompt_0.user.txt").write_text(user_text)
                raise StopAfterCapture()
            captured = json.loads((work / "prompt_0.json").read_text())
            if (without_nonces(system_text) != without_nonces(captured["system"])
                    or without_nonces(user_text) != without_nonces(captured["user"])):
                raise RuntimeError("the prompt PR-Agent renders now differs from the captured one (PR text, "
                                   "settings, earlier findings or the date changed); capture and answer again")
            return (work / "answer_0.yaml").read_text(), "stop"

    return FileHandler


async def main(mode: str, pr_url: str, work: Path, signature: str = "") -> int:
    work.mkdir(parents=True, exist_ok=True)
    meta_path, answer, preview = work / "meta.json", work / "answer_0.yaml", work / "preview.md"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else None

    if mode in ("preview", "publish"):
        if not meta or meta.get("pr_url") != pr_url:
            print(f"refusing: {meta_path} is missing or belongs to another PR; run capture first")
            return 1
        for name in ("prompt_0.json", "prompt_0.system.txt", "prompt_0.user.txt"):
            if sha256(work / name) != meta["hashes"][name]:
                print(f"refusing: {name} changed since capture")
                return 1
        if not answer.exists():
            print(f"refusing: {answer} does not exist")
            return 1
    if mode == "publish":
        if not signature.strip():
            print("refusing: publish needs a signature")
            return 1
        if (meta.get("previewed_answer_sha256") != sha256(answer) or meta.get("previewed_signature") != signature
                or not preview.exists()):
            print("refusing: run preview with this answer and signature first")
            return 1

    started = time.time()
    if mode == "capture":
        for old in work.glob("prompt_0*"):
            old.unlink()
    elif mode == "preview":
        preview.unlink(missing_ok=True)

    s = get_settings()
    s.set("CONFIG.MODEL", TOKEN_COUNT_MODEL)
    s.set("CONFIG.FALLBACK_MODELS", [])
    s.set("CONFIG.CUSTOM_MODEL_MAX_TOKENS", 200000)
    s.set("CONFIG.PUBLISH_OUTPUT", mode == "publish")
    from pr_agent.tools import pr_reviewer

    state = {"head": None, "sent": [], "error": None}
    expected = strip_hidden(preview.read_text()) if mode == "publish" else None

    def pin(settings):
        settings.set("CONFIG.PUBLISH_OUTPUT", mode == "publish")
        for key, value in PINNED.items():
            settings.set(key, value)

    original_apply = pr_agent_module.apply_repo_settings

    def apply_then_pin(*args, **kwargs):
        result = original_apply(*args, **kwargs)
        pin(get_settings())
        return result

    def config_errors_fail_closed(config_errors, git_provider):
        # PR-Agent would post an error comment here and carry on with defaults. apply_repo_settings swallows any
        # exception raised here, so record the error and let pinned_run refuse to start the review.
        state["error"] = RuntimeError(f"the target repository's PR-Agent settings could not be applied: "
                                      f"{[e.get('error') for e in config_errors]}")

    pr_agent_module.apply_repo_settings = apply_then_pin
    provider_utils.handle_configurations_errors = config_errors_fail_closed

    def guard_sends(provider):
        """Every comment goes through publish_comment or edit_comment; check it before anything is sent."""
        original_publish, original_edit = provider.publish_comment, provider.edit_comment

        def check(body):
            if mode != "publish":
                raise RuntimeError(f"{mode} tried to post a comment; nothing was sent")
            if strip_hidden(body) != expected:
                (work / "refused.md").write_text(body)
                raise RuntimeError("the comment about to be posted differs from preview.md (saved as refused.md); "
                                   "nothing was sent")
            if len(body) > provider.max_comment_chars:
                raise RuntimeError("the signed comment exceeds GitHub's size limit and would be truncated")

        def publish_comment(body, *args, **kwargs):
            if kwargs.get("is_temporary") or (args and args[0] is True):
                # Progress comments are pinned off; the provider drops them without posting.
                return original_publish(body, *args, **kwargs)
            check(body)
            sent = original_publish(body, *args, **kwargs)
            state["sent"].append(sent)
            return sent

        def edit_comment(comment, body, *args, **kwargs):
            check(body)
            result = original_edit(comment, body, *args, **kwargs)
            if result is not False:
                state["sent"].append(comment)
            return result

        provider.publish_comment, provider.edit_comment = publish_comment, edit_comment

    original_run = pr_reviewer.PRReviewer.run
    original_previous = pr_reviewer.PRReviewer._load_previous_findings_context

    def previous_findings_readonly(self):
        # Real PR-Agent puts findings from earlier reviews into the prompt, but only reads them when publishing
        # is on. Read them (read-only) in capture and preview too, or the prompt would differ from a real run.
        settings = get_settings()
        old = settings.config.publish_output
        settings.set("CONFIG.PUBLISH_OUTPUT", True)
        try:
            return original_previous(self)
        finally:
            settings.set("CONFIG.PUBLISH_OUTPUT", old)

    async def pinned_run(self):
        try:
            if state["error"] is not None:
                raise state["error"]
            pin(get_settings())
            guard_sends(self.git_provider)
            state["head"] = self.git_provider.pr.head.sha
            if mode != "capture" and state["head"] != meta["head_sha"]:
                raise RuntimeError(f"PR head moved from {meta['head_sha'][:9]} to {state['head'][:9]} since capture")
            result = await original_run(self)
        except StopAfterCapture:
            raise
        except Exception as e:
            state["error"] = state["error"] or e
            raise
        artifact = (get_settings().get("data") or {}).get("artifact")
        if artifact and mode == "preview":
            preview.write_text(artifact if isinstance(artifact, str) else str(artifact))
        return result

    pr_reviewer.PRReviewer.run = pinned_run
    if mode != "publish":
        pr_reviewer.PRReviewer._load_previous_findings_context = previous_findings_readonly
    if signature:
        original_prepare = pr_reviewer.PRReviewer._prepare_pr_review

        def prepare_signed(self):
            markdown = original_prepare(self)
            return f"{markdown}\n\n{signature}" if markdown else markdown

        pr_reviewer.PRReviewer._prepare_pr_review = prepare_signed

    agent = PRAgent(ai_handler=make_handler(mode, work))
    try:
        ok = await agent.handle_request(pr_url, ["review"], propagate_tool_errors=True)
    except StopAfterCapture:
        ok = False
    except Exception as e:
        state["error"] = state["error"] or e
        ok = False
    if state["error"] is not None and not isinstance(state["error"], StopAfterCapture):
        print(f"{mode} failed: {state['error']}")
        return 1

    if mode == "capture":
        prompt = work / "prompt_0.json"
        if not prompt.exists() or prompt.stat().st_mtime < started:
            print("capture failed: no prompt was written (check the token, the URL and the log above)")
            return 1
        names = ("prompt_0.json", "prompt_0.system.txt", "prompt_0.user.txt")
        hashes = {name: sha256(work / name) for name in names}
        if answer.exists() and (not meta or meta.get("hashes") != hashes):
            stale = answer.with_suffix(f".stale-{int(started)}.yaml")
            answer.rename(stale)
            print(f"the prompt changed, so the old answer was moved to {stale.name}")
        meta_path.write_text(json.dumps({"pr_url": pr_url, "head_sha": state["head"], "hashes": hashes}, indent=2))
        print(f"captured prompt for head {state['head'][:9]} in {work}")
        return 0

    if mode == "preview":
        if not ok or not preview.exists() or preview.stat().st_mtime < started:
            print(f"preview failed: PR-Agent did not render a review (handle_request returned {ok}); "
                  "the answer probably does not match the prompt's schema")
            return 1
        meta.update(previewed_answer_sha256=sha256(answer), previewed_signature=signature)
        meta_path.write_text(json.dumps(meta, indent=2))
        print(f"preview written to {preview}")
        return 0

    if not ok or not state["sent"]:
        print("publish failed: nothing was posted (see the log above)")
        return 1
    print(f"published {getattr(state['sent'][-1], 'html_url', state['sent'][-1])}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 4 or sys.argv[1] not in ("capture", "preview", "publish"):
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2], Path(sys.argv[3]), sys.argv[4] if len(sys.argv) > 4 else "")))
