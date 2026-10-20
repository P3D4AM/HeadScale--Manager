"""تست ثبت دوربین‌ها (CRUD) و بررسی‌کننده دسترسی (با mock دستورات headscale)."""

from hem.cameras.checker import check_camera
from hem.cameras.registry import Camera, add, load, remove, save
from hem.headscale import ctl


def test_registry_crud(tmp_path):
    path = tmp_path / "cameras.yaml"
    # خواندن از فایل ناموجود → لیست خالی
    assert load(path) == []

    cam = Camera(name="nvr-daftar", host="192.168.1.108", http_port=80, rtsp_port=554,
                 brand="dahua", notes="دفتر مرکزی")
    add(cam, path)
    cams = load(path)
    assert len(cams) == 1
    assert cams[0].name == "nvr-daftar"
    assert cams[0].host == "192.168.1.108"
    assert cams[0].http_port == 80
    assert cams[0].brand == "dahua"

    # افزودن هم‌نام → جایگزینی (نه تکرار)
    add(Camera(name="nvr-daftar", host="192.168.1.109"), path)
    assert len(load(path)) == 1
    assert load(path)[0].host == "192.168.1.109"

    assert remove("nvr-daftar", path) is True
    assert load(path) == []
    assert remove("nvr-daftar", path) is False


def test_registry_save_yaml_schema(tmp_path):
    import yaml

    path = tmp_path / "cameras.yaml"
    save([Camera(name="cam1", host="10.0.0.5", rtsp_port=554)], path)
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert "cameras" in data
    entry = data["cameras"][0]
    assert entry["name"] == "cam1"
    assert entry["rtsp_port"] == 554
    # هیچ فیلد رمز/کاربر نباید در schema باشد
    for forbidden in ("password", "username", "secret", "token"):
        assert forbidden not in entry


def _routes_mock(routes):
    return lambda: routes


def _nodes_mock(nodes):
    return lambda: nodes


def test_checker_route_missing(monkeypatch):
    monkeypatch.setattr(ctl, "routes_summary", _routes_mock([
        {"id": 7, "name": "office", "approved": ["192.168.1.0/24"], "online": True},
    ]))
    monkeypatch.setattr(ctl, "nodes_list", _nodes_mock([]))
    cam = Camera(name="cam", host="10.10.10.5")
    result = check_camera(cam)
    assert result["status"] == "route_missing"
    assert result["advice"]


def test_checker_router_offline(monkeypatch):
    monkeypatch.setattr(ctl, "routes_summary", _routes_mock([
        {"id": 7, "name": "office", "approved": ["192.168.1.0/24"], "online": False},
    ]))
    monkeypatch.setattr(ctl, "nodes_list", _nodes_mock([]))
    cam = Camera(name="cam", host="192.168.1.108")
    result = check_camera(cam)
    assert result["status"] == "router_offline"


def test_checker_net_ok(monkeypatch):
    monkeypatch.setattr(ctl, "routes_summary", _routes_mock([
        {"id": 7, "name": "office", "approved": ["192.168.1.0/24"], "online": True},
    ]))
    monkeypatch.setattr(ctl, "nodes_list", _nodes_mock([
        {"id": 7, "name": "office", "user": {"name": "admin"}, "online": True},
    ]))
    cam = Camera(name="cam", host="192.168.1.108", http_port=80, rtsp_port=554)
    result = check_camera(cam, from_client=False)
    assert result["status"] == "net_ok"
    assert result["router"] == "office"


def test_checker_net_fail_with_tcp(monkeypatch):
    monkeypatch.setattr(ctl, "routes_summary", _routes_mock([
        {"id": 7, "name": "office", "approved": ["192.168.1.0/24"], "online": True},
    ]))
    monkeypatch.setattr(ctl, "nodes_list", _nodes_mock([]))

    def _fail_tcp(host, port, timeout=5):
        return False

    import hem.cameras.checker as checker_mod

    monkeypatch.setattr(checker_mod, "_tcp_test", _fail_tcp)
    cam = Camera(name="cam", host="192.168.1.108", http_port=80, rtsp_port=554)
    result = check_camera(cam, from_client=True)
    assert result["status"] == "net_fail"
    assert result["ports"] == {"http": False, "rtsp": False}
