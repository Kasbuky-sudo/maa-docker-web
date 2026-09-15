"""Deploy maa-docker-web to a fnOS NAS over SSH.

Usage: python x86nas-deploy.py <host> <version-tag>
Creates compose project under /vol1/1000/docker/maa-docker-web, pulls images, starts stack.
"""
import sys
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = sys.argv[1] if len(sys.argv) > 1 else "192.168.31.87"
VERSION = sys.argv[2] if len(sys.argv) > 2 else "main"
PROXY = sys.argv[3] if len(sys.argv) > 3 else ""
USER = "user"
PASSWORD = "song721026"
BASE = "/vol1/1000/docker/maa-docker-web"

COMPOSE = """name: maa-docker-web

services:
  maa-server:
    image: ghcr.io/kasbuky-sudo/maa-server:{version}
    container_name: maa-server
    restart: unless-stopped
    volumes:
      - ./data/config:/app/data/config
      - ./data/logs:/app/data/logs
      - ./data/resource:/app/data/resource
      - ./data/runtime:/app/data/runtime
    environment:
      TZ: Asia/Shanghai
      LOG_LEVEL: info
      AUTO_FETCH_RUNTIME: "true"
      HTTP_PROXY: {proxy}
      HTTPS_PROXY: {proxy}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

  maa-web:
    image: ghcr.io/kasbuky-sudo/maa-web:{version}
    container_name: maa-web
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      maa-server:
        condition: service_healthy
""".format(version=VERSION, proxy=PROXY)

ENV_FILE = """WEB_PORT=8080
VERSION={version}
TZ=Asia/Shanghai
LOG_LEVEL=info
AUTO_FETCH_RUNTIME=true
""".format(version=VERSION)


def run(ssh, cmd, timeout=600):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def sudo_cmd(cmd):
    # fnOS: deploy user is not in the docker group; pipe password to sudo -S
    return f"echo '{PASSWORD}' | sudo -S -p '' {cmd}"


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, 22, USER, PASSWORD, timeout=15)
    try:
        for d in ("config", "logs", "resource", "runtime"):
            code, out, err = run(ssh, f"mkdir -p {BASE}/data/{d}")
            assert code == 0, err

        sftp = ssh.open_sftp()
        with sftp.open(f"{BASE}/docker-compose.yml", "w") as f:
            f.write(COMPOSE)
        with sftp.open(f"{BASE}/.env", "w") as f:
            f.write(ENV_FILE)
        sftp.close()
        print(f"[ok] compose files written (VERSION={VERSION})")

        # Ensure the project dir is readable by the container runtime
        run(ssh, sudo_cmd(f"chmod -R a+rwx {BASE}/data"))

        code, out, err = run(ssh, sudo_cmd(
            f"docker compose --project-directory {BASE} -f {BASE}/docker-compose.yml pull"), timeout=900)
        print(f"--- pull (exit {code})\n{out[-1500:]}{err[-500:]}")
        if code != 0:
            sys.exit(1)

        code, out, err = run(ssh, sudo_cmd(
            f"docker compose --project-directory {BASE} -f {BASE}/docker-compose.yml up -d"), timeout=300)
        print(f"--- up (exit {code})\n{out[-1500:]}{err[-500:]}")
        if code != 0:
            sys.exit(1)

        code, out, err = run(ssh, sudo_cmd(
            "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Image}}' | grep -E 'maa-(server|web)'"))
        print(f"--- containers\n{out}")
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
