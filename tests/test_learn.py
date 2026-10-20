"""تست اسکن فصل‌های مستندات فارسی — روی docs/fa واقعی مخزن."""

from hem.learn import chapters, explain


def test_scan_real_docs():
    found = chapters.list_chapters()
    assert len(found) >= 14
    # مرتب بر اساس order
    numbers = [c.number for c in found]
    assert numbers == sorted(numbers)
    assert numbers[0] == 1


def test_frontmatter_parsed():
    found = chapters.list_chapters()
    first = found[0]
    assert first.number == 1
    assert first.title == "فصل اول: VPN چیست؟"
    assert first.description  # توضیح یک‌خطی موجود است
    assert first.filename == "01-vpn-chist.md"


def test_read_chapter_without_frontmatter():
    text = chapters.read_chapter(1)
    assert text is not None
    assert not text.startswith("---")
    assert "title:" not in text.splitlines()[0] if text.strip() else True


def test_read_missing_chapter():
    assert chapters.read_chapter(999) is None
    assert chapters.read_chapter("abc") is None


def test_explain_topics_complete():
    expected = {
        "vpn", "headscale", "dns", "routes", "subnet-router", "exit-node",
        "firewall", "tls", "derper", "magicdns", "preauthkey", "backup",
    }
    assert expected == set(explain.TOPICS.keys())
    for info in explain.TOPICS.values():
        assert info["title_fa"]
        assert len(info["summary_fa"]) > 20
        assert info["chapter_order"] in range(1, 15)
        assert info["commands"]


def test_explain_fuzzy_match():
    assert explain._find_topic("subnet") == "subnet-router"
    assert explain._find_topic("SUBNET-ROUTER") == "subnet-router"
    assert explain._find_topic("preauth") == "preauthkey"
    assert explain._find_topic("nonexistent-topic-xyz") is None
