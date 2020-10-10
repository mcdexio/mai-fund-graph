import { BigInt, ethereum, log, Address } from "@graphprotocol/graph-ts"
import {
    Purchase as PurchaseEvent,
    Redeem as RedeemEvent,
    Transfer as TransferEvent,
    SetParameter as SetParameterEvent,
    IncreaseRedeemingShareBalance as IncreaseRedeemingShareBalanceEvent,
    DecreaseRedeemingShareBalance as DecreaseRedeemingShareBalanceEvent,
    RequestToRedeem as RequestToRedeemEvent,
    CancelRedeeming as CancelRedeemingEvent,
    Settle as SettleEvent,
    UpdateState as UpdateStateEvent
} from '../generated/mai-fund-graph/Fund';

import {
    fetchFund,
    fetchUser,
    fetchUserInFund,
    ZERO_BD,
    BI_18,
    ADDRESS_ZERO,
    convertToDecimal
} from './utils'

import { Purchase, Redeem, Redeemed, Transaction,  } from '../generated/schema';

export function handleSetParameter(event: SetParameterEvent): void {
    let fund = fetchFund(event.address)
    let key = event.params.key.toString()
    let value = convertToDecimal(event.params.value, BI_18)
    if (key == "cap") {
        fund.cap = value
    } else if (key == "redeemingLockPeriod") {
        fund.redeemingLockPeriod = value
    } else if (key == "entranceFeeRate") {
        fund.entranceFeeRate = value
    } else if (key == "streamingFeeRate") {
        fund.streamingFeeRate = value
    } else if (key == "performanceFeeRate") {
        fund.performanceFeeRate = value
    } else if (key == "globalRedeemingSlippage") {
        fund.globalRedeemingSlippage = value
    } else if (key == "drawdownHighWaterMark") {
        fund.drawdownHighWaterMark = value
    } else if (key == "leverageHighWaterMark") {
        fund.leverageHighWaterMark = value
    } else if (key == "rebalanceSlippage") {
        fund.rebalanceSlippage = value
    } else if (key == "rebalanceTolerance") {
        fund.rebalanceTolerance = value
    }
    fund.save()
}

export function handleUpdateState(event: UpdateStateEvent): void {
    let fund = fetchFund(event.address)
    fund.state = event.params.newState
    fund.save()
}

export function handleTransfer(event:TransferEvent): void {
    let transactionHash = event.transaction.hash.toHexString()
    // user stats
    let from = event.params.from
    let userFrom = fetchUser(from)
    let userInFundFrom = fetchUserInFund(from, event.address)
    let to = event.params.to
    let userTo = fetchUser(to)
    let userInFundTo = fetchUserInFund(to, event.address)
    let fund = fetchFund(event.address)

    let transaction = Transaction.load(transactionHash)
    if (transaction == null) {
        transaction = new Transaction(transactionHash)
        transaction.blockNumber = event.block.number
        transaction.timestamp = event.block.timestamp.toI32()
        transaction.purchases = []
        transaction.redeemeds = []
    }
    let value = convertToDecimal(event.params.value, BI_18)
    // purchase
    if (from.toHexString() == ADDRESS_ZERO) {
        let purchases = transaction.purchases
        if (purchases.length === 0) {
            let purchase = new Purchase(
                event.transaction.hash
                  .toHexString()
                  .concat('-')
                  .concat(BigInt.fromI32(purchases.length).toString())
            )
            purchase.transaction = transaction.id
            purchase.timestamp = transaction.timestamp
            purchase.fund = fund.id
            purchase.to = userTo.id
            purchase.userInFund = userInFundTo.id
            purchase.shareAmount = value
            purchase.save()

            purchases.push(purchase.id)
            transaction.purchases = purchases
            transaction.save()
        }
    }

    // redeem
    if (to.toHexString() == ADDRESS_ZERO) {
        let redeemeds = transaction.redeemeds
        if (redeemeds.length === 0) {
            let redeemed = new Redeemed(
                event.transaction.hash
                  .toHexString()
                  .concat('-')
                  .concat(BigInt.fromI32(redeemeds.length).toString())
            )
            redeemed.transaction = transaction.id
            redeemed.timestamp = transaction.timestamp
            redeemed.fund = fund.id
            redeemed.from = userFrom.id
            redeemed.userInFund = userInFundFrom.id
            redeemed.shareAmount = value
            redeemed.save()

            redeemeds.push(redeemed.id)
            transaction.redeemeds = redeemeds
            transaction.save()
        }
    }

    // swap
    if (from.toHexString() != ADDRESS_ZERO && to.toHexString() != ADDRESS_ZERO) {
        let swapedAssetValue = userInFundFrom.costCollateral.div(userInFundFrom.shareAmount).times(userInFundFrom.shareAmount.minus(value))
        userInFundFrom.shareAmount = userInFundFrom.shareAmount.minus(value)
        userInFundFrom.costCollateral = userInFundFrom.costCollateral.minus(swapedAssetValue)
        userInFundFrom.save()
    
        userInFundTo.shareAmount = userInFundTo.shareAmount.plus(value)
        userInFundTo.costCollateral = userInFundTo.costCollateral.plus(swapedAssetValue)
        userInFundTo.save()
    }
}

export function handlePurchase(event: PurchaseEvent): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())
    let purchases = transaction.purchases
    let purchase = Purchase.load(purchases[purchases.length - 1])

    let netAssetValuePerShare = convertToDecimal(event.params.netAssetValuePerShare, BI_18)
    let shareAmount = convertToDecimal(event.params.shareAmount, BI_18)

    purchase.netAssetValuePerShare = netAssetValuePerShare
    purchase.logIndex = event.logIndex
    purchase.save()


    let userInFund = fetchUserInFund(event.params.account, event.address)
    userInFund.shareAmount = userInFund.shareAmount.plus(shareAmount)
    userInFund.totalPurchaseCollateral = userInFund.totalPurchaseCollateral.plus(netAssetValuePerShare.times(shareAmount))
    userInFund.totalPurchaseShare = userInFund.totalPurchaseShare.plus(shareAmount)
    userInFund.costCollateral = userInFund.costCollateral.plus(netAssetValuePerShare.times(shareAmount))
    userInFund.lastPurchaseTime = event.block.timestamp.toI32()
    userInFund.save()

    let fund = fetchFund(event.address)
    if (fund.totalSupply == ZERO_BD) {
       fund.initNetAssetValuePerShare = netAssetValuePerShare
       fund.initTimestamp = event.block.timestamp.toI32()
    }
    fund.totalSupply = fund.totalSupply.plus(shareAmount)
    fund.save()
}

export function handleRedeem(event: RedeemEvent): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())
    let redeemeds = transaction.redeemeds
    let redeemed = Redeemed.load(redeemeds[redeemeds.length - 1])

    let returnedCollateral = convertToDecimal(event.params.returnedCollateral, BI_18)
    let shareAmount = convertToDecimal(event.params.shareAmount, BI_18)

    redeemed.returnedCollateral = returnedCollateral
    redeemed.logIndex = event.logIndex
    redeemed.save()

    let userInFund = fetchUserInFund(event.params.account, event.address)
    userInFund.shareAmount = userInFund.shareAmount.minus(shareAmount)
    userInFund.totalRedeemedShare = userInFund.totalRedeemedShare.plus(shareAmount)
    userInFund.costCollateral = userInFund.costCollateral.minus(returnedCollateral)
    userInFund.totalRedeemedCollateral = userInFund.totalRedeemedCollateral.plus(returnedCollateral)
    userInFund.save()

    let fund = fetchFund(event.address)
    fund.totalSupply = fund.totalSupply.minus(shareAmount)
    fund.save()
}

export function handleSettle(event: SettleEvent): void {
    let shareAmount = convertToDecimal(event.params.shareAmount, BI_18)
    let collateralToReturn = convertToDecimal(event.params.collateralToReturn, BI_18)

    let userInFund = fetchUserInFund(event.params.account, event.address)
    userInFund.shareAmount = userInFund.shareAmount.minus(shareAmount)
    userInFund.totalRedeemedShare = userInFund.totalRedeemedShare.plus(shareAmount)
    userInFund.costCollateral = userInFund.costCollateral.minus(collateralToReturn)
    userInFund.totalRedeemedCollateral = userInFund.totalRedeemedCollateral.plus(collateralToReturn)
    userInFund.save()
    let fund = fetchFund(event.address)
    fund.totalSupply = fund.totalSupply.minus(shareAmount)
    fund.save()
}

export function handleIncreaseRedeemingShareBalance(event: IncreaseRedeemingShareBalanceEvent): void {
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    let amount = convertToDecimal(event.params.amount, BI_18)

    userInFund.redeemingShareAmount = userInFund.redeemingShareAmount.plus(amount)
    userInFund.save()
}

export function handleDecreaseRedeemingShareBalance(event: DecreaseRedeemingShareBalanceEvent): void {
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    let amount = convertToDecimal(event.params.amount, BI_18)

    userInFund.redeemingShareAmount = userInFund.redeemingShareAmount.minus(amount)
    userInFund.save()
}

export function handleRequestToRedeem(event: RequestToRedeemEvent): void {
    let userInFund = fetchUserInFund(event.params.account, event.address)
    let fund = fetchFund(event.address)
    let user = fetchUser(event.params.account)
    let transactionHash = event.transaction.hash.toHexString()
    let redeem = new Redeem(
          event.params.account
          .toHexString()
          .concat('-')
          .concat(transactionHash)
          .concat('-')
          .concat(event.logIndex.toString())
    )
    redeem.timestamp = event.block.timestamp.toI32()
    redeem.transactionHash = transactionHash
    redeem.fund = fund.id
    redeem.user = user.id
    redeem.type = 0
    redeem.userInFund = userInFund.id
    redeem.shareAmount = convertToDecimal(event.params.shareAmount, BI_18)
    redeem.slippage = convertToDecimal(event.params.slippage, BI_18)
    redeem.save()
}

export function handleCancelRedeeming(event:CancelRedeemingEvent): void {
    let userInFund = fetchUserInFund(event.params.account, event.address)
    let fund = fetchFund(event.address)
    let user = fetchUser(event.params.account)
    let transactionHash = event.transaction.hash.toHexString()
    let redeem = new Redeem(
          event.params.account
          .toHexString()
          .concat('-')
          .concat(transactionHash)
          .concat('-')
          .concat(event.logIndex.toString())
    )
    redeem.timestamp = event.block.timestamp.toI32()
    redeem.transactionHash = transactionHash
    redeem.fund = fund.id
    redeem.user = user.id
    redeem.type = 1
    redeem.userInFund = userInFund.id
    redeem.shareAmount = convertToDecimal(event.params.shareAmount, BI_18)
    redeem.save()
}
