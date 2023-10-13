import { Worker, NearAccount, captureError, NEAR, BN } from "near-workspaces";
import anyTest, { TestFn } from "ava";

const STORAGE_BYTE_COST = "1.5 mN";
const INITIAL_SUPPLY = "10000";

async function registerUser(ft: NearAccount, user: NearAccount) {
  await user.call(
    ft,
    "storage_deposit",
    { account_id: user },
    // Deposit pulled from ported sim test
    { attachedDeposit: STORAGE_BYTE_COST }
  );
}

async function ft_balance_of(ft: NearAccount, user: NearAccount): Promise<BN> {
  return new BN(await ft.view("ft_balance_of", { account_id: user }));
}

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async (t) => {
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const ft = await root.devDeploy("../../res/fungible_token.wasm", {
    initialBalance: NEAR.parse("100 N").toJSON(),
    method: "new_default_meta",
    args: {
      owner_id: root,
      total_supply: INITIAL_SUPPLY,
    },
  });
  const tokenDistribution = await root.devDeploy(
    "../../res/token_distribution.wasm",
    {
      initialBalance: NEAR.parse("100 N").toJSON(),
      method: "new",
      args: { fungible_token_account_id: ft },
    }
  );

  const ali = await root.createSubAccount("ali", {
    initialBalance: NEAR.parse("100 N").toJSON(),
  });

  console.log(ali);

  t.context.worker = worker;
  t.context.accounts = { root, ft, tokenDistribution, ali };
});

test.afterEach(async (t) => {
  await t.context.worker.tearDown().catch((error) => {
    console.log("Failed to tear down the worker:", error);
  });
});

test("Total supply", async (t) => {
  const { ft } = t.context.accounts;
  const totalSupply: string = await ft.view("ft_total_supply");
  t.is(totalSupply, INITIAL_SUPPLY);
});

test("Simple transfer", async (t) => {
  const { ft, ali, root } = t.context.accounts;
  const initialAmount = new BN(INITIAL_SUPPLY);
  const transferAmount = new BN("100");

  // Register by prepaying for storage.
  await registerUser(ft, ali);

  await root.call(
    ft,
    "ft_transfer",
    {
      receiver_id: ali,
      amount: transferAmount,
    },
    { attachedDeposit: "1" }
  );

  const rootBalance = await ft_balance_of(ft, root);
  const aliBalance = await ft_balance_of(ft, ali);

  t.deepEqual(new BN(rootBalance), initialAmount.sub(transferAmount));
  t.deepEqual(new BN(aliBalance), transferAmount);
});

test("Can close empty balance account", async (t) => {
  const { ft, ali } = t.context.accounts;

  await registerUser(ft, ali);

  const result = await ali.call(
    ft,
    "storage_unregister",
    {},
    { attachedDeposit: "1" }
  );

  t.is(result, true);
});

test("Can force close non-empty balance account", async (t) => {
  const { ft, root } = t.context.accounts;

  const errorString = await captureError(async () =>
    root.call(ft, "storage_unregister", {}, { attachedDeposit: "1" })
  );
  t.regex(
    errorString,
    /Can't unregister the account with the positive balance without force/
  );

  const result = await root.callRaw(
    ft,
    "storage_unregister",
    { force: true },
    { attachedDeposit: "1" }
  );

  t.is(result.logs[0], `Closed @${root.accountId} with ${INITIAL_SUPPLY}`);
});

test("Transfer call with burned amount", async (t) => {
  const { ft, tokenDistribution, root } = t.context.accounts;

  const initialAmount = new BN(10_000);
  const transferAmount = new BN(100);
  const burnAmount = new BN(10);

  await registerUser(ft, tokenDistribution);
  const result = await root
    .batch(ft)
    .functionCall(
      "ft_transfer_call",
      {
        receiver_id: tokenDistribution,
        amount: transferAmount,
        msg: burnAmount,
      },
      { attachedDeposit: "1", gas: "150 Tgas" }
    )
    .functionCall(
      "storage_unregister",
      { force: true },
      { attachedDeposit: "1", gas: "150 Tgas" }
    )
    .transact();

  t.true(
    result.logs.includes(
      `Closed @${root.accountId} with ${initialAmount
        .sub(transferAmount)
        .toString()}`
    )
  );

  t.is(result.parseResult(), true);

  t.true(result.logs.includes("The account of the sender was deleted"));

  t.true(
    result.logs.includes(
      `Account @${root.accountId} burned ${burnAmount.toString()}`
    )
  );

  // Help: this index is diff from sim, we have 10 len when they have 4
  const callbackOutcome = result.receipts_outcomes[5];
  t.is(callbackOutcome.parseResult(), transferAmount.toString());
  const expectedAmount = transferAmount.sub(burnAmount);
  const totalSupply: string = await ft.view("ft_total_supply");
  t.is(totalSupply, expectedAmount.toString());
  const defiBalance = await ft_balance_of(ft, tokenDistribution);
  t.deepEqual(defiBalance, expectedAmount);
});

test("Transfer call immediate return no refund", async (t) => {
  const { ft, tokenDistribution, root } = t.context.accounts;
  const initialAmount = new BN(10_000);
  const transferAmount = new BN(100);

  await registerUser(ft, tokenDistribution);

  await root.call(
    ft,
    "ft_transfer_call",
    {
      receiver_id: tokenDistribution,
      amount: transferAmount,
      memo: null,
      msg: "take-my-money",
    },
    { attachedDeposit: "1", gas: "150 Tgas" }
  );

  const rootBalance = await ft_balance_of(ft, root);
  const defiBalance = await ft_balance_of(ft, tokenDistribution);

  t.deepEqual(rootBalance, initialAmount.sub(transferAmount));
  t.deepEqual(defiBalance, transferAmount);
});

test("Transfer call promise panics for a full refund", async (t) => {
  const { ft, tokenDistribution, root } = t.context.accounts;
  const initialAmount = new BN(10_000);
  const transferAmount = new BN(100);

  await registerUser(ft, tokenDistribution);

  const result = await root.callRaw(
    ft,
    "ft_transfer_call",
    {
      receiver_id: tokenDistribution,
      amount: transferAmount,
      memo: null,
      msg: "this won't parse as an integer",
    },
    { attachedDeposit: "1", gas: "150 Tgas" }
  );

  t.regex(result.receiptFailureMessages.join("\n"), /ParseIntError/);

  const rootBalance = await ft_balance_of(ft, root);
  const defiBalance = await ft_balance_of(ft, tokenDistribution);

  t.deepEqual(rootBalance, initialAmount);
  t.assert(defiBalance.isZero(), `Expected zero got ${defiBalance.toJSON()}`);
});

test("add wallets to white listed wallets", async (t) => {
  const { ft, tokenDistribution, root } = t.context.accounts;
  const wallets: string[] = ["test.near", "test2.near"];
  await root.call(tokenDistribution, "store_wallets", { wallets });
  const whitelistedWallets: string[] = await tokenDistribution.view(
    "get_whitelisted_wallets",
    {}
  );
  t.is(whitelistedWallets, wallets);
});
