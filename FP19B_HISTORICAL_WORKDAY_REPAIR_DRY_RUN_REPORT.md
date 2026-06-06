# FP-19B HISTORICAL WORKDAY REPAIR DRY RUN REPORT
Total Sessions Scanned: 156
Suspicious Sessions: 117
Auto Repair Candidates: 17
Manual Review Needed: 100
Suspicious Break Logs: 2

## Per User Summary
- User cmp564b0s001uxwtf27ivohdh: 9 suspicious sessions
- User cmp6ux3a8002q13yg2xixkjkl: 10 suspicious sessions
- User cmp56458g000kxwtfgr7tplbs: 3 suspicious sessions
- User cmpasn4kv00247rgvnqgj08gh: 8 suspicious sessions
- User cmp5645vj000qxwtfnwh7k3ew: 2 suspicious sessions
- User cmp564akv001sxwtf08gcor34: 3 suspicious sessions
- User cmp564abg001qxwtfsaxc6qv9: 5 suspicious sessions
- User cmp564e0s002exwtfjkzwdz19: 8 suspicious sessions
- User cmp5647cg0012xwtf6x9u7lg5: 4 suspicious sessions
- User cmp564b9k001wxwtf3d0mo8ok: 4 suspicious sessions
- User cmp5646yf000yxwtf8guthzlh: 7 suspicious sessions
- User cmp5645o8000oxwtffkdhldwx: 7 suspicious sessions
- User cmp56475f0010xwtfhdqgssy3: 8 suspicious sessions
- User cmp56469u000uxwtfgfml14vq: 3 suspicious sessions
- User cmp5644u6000ixwtfwqqa2qca: 5 suspicious sessions
- User cmp564bkx001yxwtfvrgfywqq: 4 suspicious sessions
- User cmp5648dh001axwtfcv1kcqlu: 3 suspicious sessions
- User cmp564e98002gxwtfqlil4exp: 3 suspicious sessions
- User cmp564cm30026xwtf3uj0yexl: 3 suspicious sessions
- User cmp56499y001ixwtf4fg0oq02: 3 suspicious sessions
- User cmp564924001gxwtfobftv6vy: 1 suspicious sessions
- User cmp564epy002kxwtfd9q8u2kd: 1 suspicious sessions
- User cmp56483s0018xwtf8nz2453r: 1 suspicious sessions
- User cmpavq4ge0001qugud7o0rs7b: 2 suspicious sessions
- User cmpwb2xgn0009rd9pb4c3y5aq: 1 suspicious sessions
- User cmpwb2xux000brd9pcoafl0vk: 1 suspicious sessions
- User cmpwb2z3i000hrd9pcwikqoht: 1 suspicious sessions
- User cmpwb2yah000drd9potz0t0ov: 1 suspicious sessions
- User cmpwb2yp4000frd9p3d9fk44c: 1 suspicious sessions
- User cmpy3yhzm0009t2vsjeeesdei: 1 suspicious sessions
- User cmpy3yk3i000bt2vswsbbd085: 1 suspicious sessions
- User cmpy41uf90019t2vsjvqct80m: 1 suspicious sessions
- User cmpy41wje001bt2vshpvnz4a3: 1 suspicious sessions
- User cmp564a01001oxwtfmnxpgcfx: 1 suspicious sessions

## Per Date Summary
- Date 2026-05-20: 2 suspicious sessions
- Date 2026-05-21: 4 suspicious sessions
- Date 2026-05-22: 8 suspicious sessions
- Date 2026-05-25: 6 suspicious sessions
- Date 2026-05-26: 8 suspicious sessions
- Date 2026-05-27: 9 suspicious sessions
- Date 2026-05-28: 2 suspicious sessions
- Date 2026-05-29: 9 suspicious sessions
- Date 2026-05-30: 5 suspicious sessions
- Date 2026-06-01: 18 suspicious sessions
- Date 2026-06-02: 13 suspicious sessions
- Date 2026-06-03: 18 suspicious sessions
- Date 2026-06-04: 15 suspicious sessions

## Detailed Proposed Changes
```json
[
  {
    "sessionId": "cmpe252zd0001skiz24h0e6pt",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-05-20T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.077Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpe28bnc0005skiz4bm79got",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-05-20T00:00:00.000Z",
    "originalLogoutAt": "2026-05-20T13:48:59.140Z",
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 7: Open break in closed session"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpf01iln00013eda01ejd4i3",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-05-21T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.446Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpf0pslr00143edaeadgxdba",
    "userId": "cmp56458g000kxwtfgr7tplbs",
    "date": "2026-05-21T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.050Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpf17jvi005f3edak0xejowi",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-05-21T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.154Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpf19cx0005j3eda5fm7w2re",
    "userId": "cmp5645vj000qxwtfnwh7k3ew",
    "date": "2026-05-21T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.549Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgedo200001rja7idyb7o4e",
    "userId": "cmp564akv001sxwtf08gcor34",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.659Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgef7m50005rja7kdns5yr5",
    "userId": "cmp564abg001qxwtfsaxc6qv9",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.290Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgfpn51003brja7223204qa",
    "userId": "cmp5645vj000qxwtfnwh7k3ew",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.345Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgft6rp003jrja7wkc31mbq",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.274Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgg8yd3004frja7b2tldvo6",
    "userId": "cmp5647cg0012xwtf6x9u7lg5",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.368Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpghadnk0050rja72pdkqerw",
    "userId": "cmp564b9k001wxwtf3d0mo8ok",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.483Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgx92pm002i16cf8251pz13",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.091Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpgxymxa003t16cf1nhoglbn",
    "userId": "cmp56458g000kxwtfgr7tplbs",
    "date": "2026-05-22T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.172Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpkra9o0005oqko3t4zhvp5r",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-05-25T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.584Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpkrnzho0067qko3bb3gdeql",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-05-25T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.768Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpksr7r90084qko3sqmksa54",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-05-25T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.358Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpkvlg3c00f7qko3t97y5oew",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-05-25T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.752Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpl1t0xi009gge80d680ih9y",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-05-25T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.249Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpl54fwy002whqyvov515f6h",
    "userId": "cmp56469u000uxwtfgfml14vq",
    "date": "2026-05-25T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.261Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpm4g60j000u12orj85a81u4",
    "userId": "cmp564abg001qxwtfsaxc6qv9",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.184Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpm5recv003j12or3w46qgev",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.648Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpm5zslp003v12orvyi4rnmk",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-05-26T07:12:37.677Z",
    "originalStatus": "WORKING",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 2: Past date active status",
      "Rule 6: logoutAt before start time"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpm6ee4y004s12orp1hur7la",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.576Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpm753pp005812or7019f64d",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.868Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpmaqgxu00a63um4nh1llvmq",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.999Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpmfg8sc002m7f93cbr0ahj4",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.462Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpmmwzk500eb7f93oh0hdca7",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-05-26T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.879Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnj87nv0007113rb6ny6lej",
    "userId": "cmp564abg001qxwtfsaxc6qv9",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.853Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnjzgd5002h113rhk2m6uac",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-05-27T10:40:45.285Z",
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 6: logoutAt before start time",
      "Rule 7: Open break in closed session"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnku9ut0039113rr6cei0yk",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.062Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnlbz4o005d113r9b5od2fg",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.601Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnlcche005n113r46tswrv8",
    "userId": "cmp564b9k001wxwtf3d0mo8ok",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.075Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnleswl006o113rfio8cwys",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.473Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnlwy7x0072113runjndv05",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.141Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnmlxzq00dy113rttp7och9",
    "userId": "cmp5644u6000ixwtfwqqa2qca",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.064Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpnz2kii007684nb14jcqirs",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-05-27T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.049Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpoz3iy90024124vqryk3eib",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-05-28T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.975Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmppc035g007a6vkjjpmanfu8",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-05-28T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.942Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqefkww00198q837a6evei0",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-05-29T07:23:11.947Z",
    "originalStatus": "WORKING",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 2: Past date active status",
      "Rule 6: logoutAt before start time"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqeg0sm001f8q83jdaf2qcg",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.372Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqepjkn003h8q83ey8v61tt",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.340Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqetun2003n8q83y1p05ju0",
    "userId": "cmp564bkx001yxwtfvrgfywqq",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.264Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqfmwmj006q8q833tzs3m5f",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.359Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqfvjqv007i8q83nx3zntrd",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-05-29T05:19:56.190Z",
    "originalStatus": "WORKING",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 2: Past date active status",
      "Rule 6: logoutAt before start time"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqh0rjn00fh8q83a0ca35nd",
    "userId": "cmp56469u000uxwtfgfml14vq",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.382Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqjqd6v00lb8q83ys06ge6z",
    "userId": "cmp56458g000kxwtfgr7tplbs",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.254Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpqyqpvl01eo8q83aiguq70w",
    "userId": "cmp5648dh001axwtfcv1kcqlu",
    "date": "2026-05-29T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.274Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpru21d6001s58e9dhadbipi",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-05-30T00:00:00.000Z",
    "originalLogoutAt": "2026-05-30T04:17:22.181Z",
    "originalStatus": "WORKING",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 2: Past date active status",
      "Rule 6: logoutAt before start time"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpruj037004h58e9vnyjtm8u",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-05-30T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.167Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpryijts00b358e9jo2gu7uz",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-05-30T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.556Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpryitxw00bf58e96mdm6rv6",
    "userId": "cmp564bkx001yxwtfvrgfywqq",
    "date": "2026-05-30T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.156Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmps5bjig00me58e9rza0lrj3",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-05-30T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:00.017Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpup2kc2001yn6ib3kqoawzn",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.451Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpup9yp5002yn6ibrldnkr8b",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.241Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpuqcyjy0069n6ibu668amxv",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.844Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpurk4n100akn6ibvv3q6133",
    "userId": "cmp564e98002gxwtfqlil4exp",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.756Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmputnkrl00mjn6ibevad6wi5",
    "userId": "cmp56469u000uxwtfgfml14vq",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.580Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmputsqfx001qf7wsk24d3v6h",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.464Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpuv5dpr0001l2iill2g24a0",
    "userId": "cmp5647cg0012xwtf6x9u7lg5",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.564Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpuv86q40007l2ii6ztoa6d8",
    "userId": "cmp564cm30026xwtf3uj0yexl",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.479Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpuzbk6v002k5c25mt88sll3",
    "userId": "cmp56499y001ixwtf4fg0oq02",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.672Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpuzd3wc002z5c25yfm3edd0",
    "userId": "cmp564924001gxwtfobftv6vy",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.492Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpv20y7b00745c25xopisqod",
    "userId": "cmp564epy002kxwtfd9q8u2kd",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.650Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpv23nt200825c25b5qlegn6",
    "userId": "cmp56483s0018xwtf8nz2453r",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.661Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpv4mp1m00nn5c25b9j27125",
    "userId": "cmpavq4ge0001qugud7o0rs7b",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.741Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpw3wm97000yidlfoggz174q",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:12:12.134Z",
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpw40cfo002lidlfwzhljyyt",
    "userId": "cmpavq4ge0001qugud7o0rs7b",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:40:29.988Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpw5brzv007widlfnofqkx22",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-02T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpw6573r00agidlf2iut029o",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-02T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpw878yr003dq3nvyxgsmpvw",
    "userId": "cmp5647cg0012xwtf6x9u7lg5",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-02T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpw9x4ww00jwq3nvfv5ittzs",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:11:13.797Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpwb39my0001nduhue8ov0ej",
    "userId": "cmpwb2xgn0009rd9pb4c3y5aq",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.974Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpwb3wcd000jnduhlencg9me",
    "userId": "cmpwb2xux000brd9pcoafl0vk",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:02.036Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpwb4ekq000pnduhooihxpma",
    "userId": "cmpwb2z3i000hrd9pcwikqoht",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.859Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpwb6a7c002jnduhzq0g3gvj",
    "userId": "cmpwb2yah000drd9potz0t0ov",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.946Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpwbm8cl002f9hik5qh3r7au",
    "userId": "cmpwb2yp4000frd9p3d9fk44c",
    "date": "2026-06-01T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T11:15:01.961Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpwm1hmy0015y9t52hj7zi48",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-02T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxj69u500017dfonk142lvp",
    "userId": "cmp564akv001sxwtf08gcor34",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T03:53:43.040Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxji7xa001a7dforkp1orr1",
    "userId": "cmp564bkx001yxwtfvrgfywqq",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T03:54:33.223Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjngwi001m7dfou4ddezvs",
    "userId": "cmp564abg001qxwtfsaxc6qv9",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T03:54:02.129Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjp14z002k7dfoxjf4j8fc",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:16:04.767Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjq3c1002q7dfolpz4inh8",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:07:06.362Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjrqaa00387dfojm7helvb",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:33:07.494Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjukan003v7dfosp4vg4l5",
    "userId": "cmp564b9k001wxwtf3d0mo8ok",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:21:39.052Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjuy6m004s7dfoez369axe",
    "userId": "cmp564e98002gxwtfqlil4exp",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:04:30.734Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxjxbjf005o7dforsckf5m8",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:07:34.179Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxkxwqa009z7dfovkbevmb0",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:21:38.894Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxlkojz00bb7dfocw1cayst",
    "userId": "cmp564cm30026xwtf3uj0yexl",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T04:44:23.995Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 3: Duration > 16h",
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxq3y8y00265njp8vqasmnr",
    "userId": "cmp5644u6000ixwtfwqqa2qca",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxuc6dc00ax13wamu50p05j",
    "userId": "cmp5645o8000oxwtffkdhldwx",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxx2sla00kq13wa2bdyzakg",
    "userId": "cmp5647cg0012xwtf6x9u7lg5",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpxypstv000d1qaxzb9rb76o",
    "userId": "cmp5644u6000ixwtfwqqa2qca",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpy3s6vk006lyfyi9m80dibz",
    "userId": "cmp5648dh001axwtfcv1kcqlu",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpy3s8bn006ryfyijpbobpbs",
    "userId": "cmp5648dh001axwtfcv1kcqlu",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpy3ylte000dt2vsfcy2tal5",
    "userId": "cmpy3yhzm0009t2vsjeeesdei",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpy3yn7r000jt2vsvjps8mma",
    "userId": "cmpy3yk3i000bt2vswsbbd085",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpy41ybo001dt2vsi1qjmlcv",
    "userId": "cmpy41uf90019t2vsjvqct80m",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpy420l0001jt2vs02encbqi",
    "userId": "cmpy41wje001bt2vshpvnz4a3",
    "date": "2026-06-02T00:00:00.000Z",
    "originalLogoutAt": "2026-06-03T18:30:00.000Z",
    "originalStatus": "AUTO_CLOSED",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpyymltm000112b10hbro7fg",
    "userId": "cmp564akv001sxwtf08gcor34",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyyocxz000n12b18n4su6ry",
    "userId": "cmp564bkx001yxwtfvrgfywqq",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyz22tw002d12b13yd88kw4",
    "userId": "cmp564e98002gxwtfqlil4exp",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyz49p3002j12b1f88fwtxa",
    "userId": "cmp564e0s002exwtfjkzwdz19",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyz5513003112b1wfkxdq02",
    "userId": "cmp6ux3a8002q13yg2xixkjkl",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyz6ieq003b12b1nuvzv7kg",
    "userId": "cmp56499y001ixwtf4fg0oq02",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyz6n0n003h12b156dqepcm",
    "userId": "cmp56499y001ixwtf4fg0oq02",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": "2026-06-04T13:05:53.324Z",
    "originalStatus": "LOGGED_OUT",
    "proposedLogoutAt": null,
    "proposedAutoClosed": null,
    "proposedAutoClosedAt": null,
    "proposedClosureReason": null,
    "proposedStatus": null,
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 4: Spans multiple dates"
    ],
    "classification": "MANUAL_REVIEW"
  },
  {
    "sessionId": "cmpyz9q02003v12b123hts4mt",
    "userId": "cmp564b0s001uxwtf27ivohdh",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyzhk0w004912b1odlngmkx",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyzhpad004f12b163wagqzq",
    "userId": "cmp56475f0010xwtfhdqgssy3",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "WORKING",
    "proposedLogoutAt": "2026-06-03T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session",
      "Rule 2: Past date active status"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyzmwb1004l12b1ov1c7qtt",
    "userId": "cmp5646yf000yxwtf8guthzlh",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyznann004r12b1lztx2bu5",
    "userId": "cmp564b9k001wxwtf3d0mo8ok",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpyzrwmj005512b1vo557jfm",
    "userId": "cmp564a01001oxwtfmnxpgcfx",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpz01vnq005o12b1i8ky2gjw",
    "userId": "cmpasn4kv00247rgvnqgj08gh",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpz0iamt006212b1l1k6z2xk",
    "userId": "cmp564cm30026xwtf3uj0yexl",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpzc8ss7008jsws70rm8gweb",
    "userId": "cmp564abg001qxwtfsaxc6qv9",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpzgvvp00001cmczmnikx8te",
    "userId": "cmp5644u6000ixwtfwqqa2qca",
    "date": "2026-06-04T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "LOGGED_IN",
    "proposedLogoutAt": "2026-06-04T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  },
  {
    "sessionId": "cmpzgwb350007cmczwucgvn7c",
    "userId": "cmp5644u6000ixwtfwqqa2qca",
    "date": "2026-06-03T00:00:00.000Z",
    "originalLogoutAt": null,
    "originalStatus": "WORKING",
    "proposedLogoutAt": "2026-06-03T18:29:00.000Z",
    "proposedAutoClosed": true,
    "proposedAutoClosedAt": "2026-06-04T19:13:28.579Z",
    "proposedClosureReason": "HISTORICAL_REPAIR_AUTO_CLOSE",
    "proposedStatus": "AUTO_CLOSED",
    "breakLogChanges": [],
    "rulesTriggered": [
      "Rule 1: Past date open session",
      "Rule 2: Past date active status"
    ],
    "classification": "AUTO_REPAIR_CANDIDATE"
  }
]
```