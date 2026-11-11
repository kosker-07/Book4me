#!/usr/bin/env bash
# Installs pdftotext (poppler-utils) for the voucher/proforma content tests.
# Hosted runners point apt at azure.archive.ubuntu.com, which intermittently fails DNS
# resolution ("Temporary failure resolving azure.archive.ubuntu.com"). Use the canonical
# Ubuntu host instead, force IPv4 and retry. A missing pdftotext must still fail the job:
# the tests refuse to run without it, so a green run never hides skipped PDF checks.
set -u

if command -v pdftotext >/dev/null 2>&1; then
  echo "pdftotext already available"
  pdftotext -v
  exit 0
fi

if [ -f /etc/apt/apt-mirrors.txt ]; then
  sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' /etc/apt/apt-mirrors.txt
fi

APT_OPTS=(-o Acquire::Retries=3 -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=30)
for attempt in 1 2 3 4; do
  echo "::group::apt attempt $attempt"
  getent hosts archive.ubuntu.com security.ubuntu.com || echo "DNS lookup for ubuntu hosts failed"
  if sudo apt-get "${APT_OPTS[@]}" update -q && \
     sudo apt-get "${APT_OPTS[@]}" install -y -q --no-install-recommends poppler-utils; then
    echo "::endgroup::"
    pdftotext -v
    exit 0
  fi
  echo "::endgroup::"
  [ "$attempt" -lt 4 ] && sleep $((attempt * 15))
done

echo "::error::pdftotext installation failed after 4 attempts"
exit 1
