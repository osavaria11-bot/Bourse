#!/usr/bin/env python3
"""Use Ubuntu's official mirrors when the runner's Azure mirror stalls."""
from pathlib import Path


def prepare(root=Path("/etc/apt")):
    paths = [root / "sources.list", root / "apt-mirrors.txt", root / "apt-mirrors-security.txt"]
    paths += list((root / "sources.list.d").glob("*.sources"))
    paths += list((root / "sources.list.d").glob("*.list"))
    for path in paths:
        if not path.is_file():
            continue
        old = path.read_text()
        new = old.replace("http://azure.archive.ubuntu.com/ubuntu", "https://archive.ubuntu.com/ubuntu")
        new = new.replace("https://azure.archive.ubuntu.com/ubuntu", "https://archive.ubuntu.com/ubuntu")
        if new != old:
            path.write_text(new)
            print("Official Ubuntu mirror:", path)


if __name__ == "__main__":
    prepare()
