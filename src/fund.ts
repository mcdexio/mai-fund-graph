import { BigInt, ethereum, log, Address } from "@graphprotocol/graph-ts"
import {
    Purchase as PurchaseEvent,
    Redeem as RedeemEvent,
    Transfer as TransferEvent,
    SetParameter as SetParameterEvent,
    SetManager as SetManagerEvent,
    IncreaseRedeemingShareBalance as IncreaseRedeemingShareBalanceEvent,
    DecreaseRedeemingShareBalance as DecreaseRedeemingShareBalanceEvent,
} from '../generated/mai-fund-graph/Fund';

import {
    Perpetual,
} from '../generated/mai-fund-graph/Perpetual';

import {
    fetchFund,
    fetchUser,
    fetchUserInFund,
    ZERO_BI
} from './utils'

import { Fund, Purchase, Redeem } from '../generated/schema';

export function handleSetParameter(event: SetParameterEvent): void {
    let fund = fetchFund(event.address)
    switch(event.params.key.toString()) {
        case "cap":
            fund.cap = event.value
            break
        case "redeemingLockPeriod":
            fund.redeemingLockPeriod = event.value
            break
        case "entranceFeeRate":
            fund.entranceFeeRate = event.value
            break
        case "streamingFeeRate":
            fund.streamingFeeRate = event.value
            break
        case "performanceFeeRate":
            fund.performanceFeeRate = event.value
            break
        case "globalRedeemingSlippage":
            fund.globalRedeemingSlippage = event.value
            break
        case "drawdownHighWaterMark":
            fund.drawdownHighWaterMark = event.value
            break
        case "leverageHighWaterMark":
            fund.leverageHighWaterMark = event.value
            break
        case "rebalanceSlippage":
            fund.rebalanceSlippage = event.value
            break
        case "rebalanceTolerance":
            fund.rebalanceTolerance = event.value
            break
        default:
            return
    }
    fund.save()
}

export function handleSetManager(event: SetManagerEvent): void {
    let fund = fetchFund(event.address)
    fund.manager = event.params.newManager.toHexString()
    fund.save()
}

export function handlePurchase(event: PurchaseEvent): void {
    let fund = fetchFund(event.address)
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    let purchases = userInFund.purchases
    userInFund.shareAmount = userInFund.shareAmount.plus(event.params.shareAmount)
    // userInFund.avgNetAssetValuePerShare = 
    purchases.push()
    userInFund.save()
    if (fund.totalSupply == ZERO_BI) {
       fund.initNetAssetValuePerShare = event.params.netAssetValue.toBigDecimal() 
    }
    fund.totalSupply = fund.totalSupply.plus(event.params.shareAmount)
    fund.save()
}

export function handleRedeem(event: RedeemEvent): void {
    let fund = fetchFund(event.address)
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    userInFund.shareAmount = userInFund.shareAmount.minus(event.params.shareAmount)
    // userInFund.avgNetAssetValuePerShare = 
    userInFund.save()
    fund.totalSupply = fund.totalSupply.minus(event.params.shareAmount)
    fund.save()
}

export function handleTransfer(event:TransferEvent): void {

}

export function handleIncreaseRedeemingShareBalance(event: IncreaseRedeemingShareBalanceEvent): void {

}

export function handleDecreaseRedeemingShareBalance(event: DecreaseRedeemingShareBalanceEvent): void {

}

export function handleBlock(block: ethereum.Block): void {
    // let netValue = new NetValue(block.hash.toHex());
    // let fund = Fund.bind(Address.fromString("0x2FC1b68B73C55B2D1A00F9cBf0BA0920409069E4"));
    // let callResult = fund.try_netAssetValuePerShare();
    // if(callResult.reverted){
    //   log.warning("Get try_netAssetValuePerShare reverted at block: {}", [block.number.toString()])
    //   netValue.value = BigInt.fromI32(0);
    // } else {
    //   netValue.value = callResult.value;
    // }
    // netValue.number = block.number;
    // netValue.save();
}
  
