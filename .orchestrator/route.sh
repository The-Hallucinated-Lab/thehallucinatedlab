#!/usr/bin/env bash
# Usage: ./.orchestrator/route.sh "<task description>"  -> prints expert name
set -euo pipefail
T=$(echo "${1:?task required}" | tr '[:upper:]' '[:lower:]')
case "$T" in
  *test*|*pytest*|*jest*|*coverage*|*fixture*)           echo tester ;;
  *audit*|*security*|*vulnerab*|*review*)                echo auditor ;;
  *refactor*|*rename*|*cleanup*|*lint*|*tidy*)           echo refactorer ;;
  *docstring*|*readme*|*document*|*changelog*|*comment*) echo documenter ;;
  *scaffold*|*structure*|*layout*|*interface*|*skeleton*) echo architect ;;
  *fix*|*repair*|*broken*|*failing*|*error*)             echo repairer ;;
  *summar*|*where*|*find*|*explain*|*locate*)            echo reader ;;
  *)
    printf 'Task: %s\nWhich single expert fits best? Reply with one word only from:\nimplementer tester auditor refactorer documenter architect repairer reader\n' "$1" \
      > .orchestrator/tmp/route.txt
    ./.orchestrator/expert.sh reader .orchestrator/tmp/route.txt 1 \
      | grep -oE 'implementer|tester|auditor|refactorer|documenter|architect|repairer|reader' \
      | head -1 || echo implementer
    ;;
esac
