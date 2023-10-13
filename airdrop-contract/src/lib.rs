use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen, AccountId, Balance, Promise};
use serde_json::json;

// Define the state of the contract
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct Contract {
    whitelisted_wallets: Vec<AccountId>,
    fungible_token_account_id: AccountId,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            fungible_token_account_id: AccountId::new_unchecked("".to_string()),
            whitelisted_wallets: vec![],
        }
    }
}

#[near_bindgen]
impl Contract {
    #[init]
    pub fn new(fungible_token_account_id: AccountId) -> Self {
        // assert!(!env::state_exists(), "Already initialized");
        Self {
            fungible_token_account_id: fungible_token_account_id.into(),
            whitelisted_wallets: vec![],
        }
    }

    // Store multiple wallet addresses in the `whitelisted_wallets` array
    pub fn store_wallets(&mut self, wallet_addresses: Vec<AccountId>) {
        for wallet in wallet_addresses {
            if !self.whitelisted_wallets.contains(&wallet) {
                self.whitelisted_wallets.push(wallet);
            }
        }
    }

    // Distribute fungible tokens to those whitelisted wallets
    pub fn distribute_tokens(&self, amount_per_wallet: Balance) {
        for wallet in &self.whitelisted_wallets {
            Promise::new(self.fungible_token_account_id.clone()).function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id":wallet , "amount": amount_per_wallet })
                    .to_string()
                    .as_bytes()
                    .to_vec(),
                0,
                near_sdk::Gas(1000000),
            );
        }
    }

    // Get the whitelisted wallets
    pub fn get_whitelisted_wallets(&self) -> Vec<AccountId> {
        self.whitelisted_wallets.clone()
    }
}
