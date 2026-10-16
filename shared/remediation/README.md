# shared/remediation

The structured remediation contract and its dialog (lifecycle foundation, Phase 1).

| Import | What | Pulls in HTTP? |
| --- | --- | --- |
| `@apex/shared-remediation` | The framework-free contract (`shared/remediation-contract.ts`), `RemediationDialog` and `useRemediation` | No |
| `@apex/shared-remediation/api` | Typed clients for the real lifecycle and preference routes, and `createRemediationActionRunner()` | Yes, through `@apex/shared-auth` |

The root barrel never re-exports `frontend/remediation-api.ts`; the architecture
self-test checks that its import graph never reaches axios.

## Using it on a screen

```tsx
const remediation = useRemediation();
const runner = useMemo(createRemediationActionRunner, []);

onError: (err) => {
  if (remediation.openFrom(err)) return; // the dialog explains it; skip the toast
  toast.error(err?.message || 'Something failed');
},

<RemediationDialog {...remediation.dialogProps} runAction={runner} />
```

The dialog is a sibling layer: the caller's form stays mounted with every value,
Escape closes only the dialog, and focus returns to the control that was pressed.

## Rules the dialog enforces

- Actions render only from `visibleActions()`: known ids, fixed in-app routes,
  allowed retry endpoints, and Safe Repair only when `canSystemRepair` is true
  and neither manual flag is set.
- Retry Verification and Safe Repair always re-run the server check; the dialog
  shows the fresh server result and closes itself only on `RESOLVED`.
- Only per-code allow-listed `details` keys are shown; Copy Diagnostic copies
  the code and operation id, nothing else.

The backend mirror is `backend/src/common/remediation`; a backend unit test keeps
the two vocabularies identical.
