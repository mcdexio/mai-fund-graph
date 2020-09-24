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
    Fund as FundContract
} from '../generated/mai-fund-graph/Fund';

import {
    Perpetual,
} from '../generated/mai-fund-graph/Perpetual';

import {
    RSITrendingStrategy,
} from '../generated/mai-fund-graph/RSITrendingStrategy';

import {
    SetManager as SetManagerEvent,
} from '../generated/mai-fund-graph/SocialTradingFund';

import {
    fetchFund,
    fetchUser,
    fetchUserInFund,
    ZERO_BI,
    ZERO_BD,
    ONE_BI,
    ONE_BD,
    BI_18,
    ADDRESS_ZERO,
    FUND_LIST,
    convertToDecimal,
    isUSDCollateral
} from './utils'

import { Fund, Purchase, Redeem, Redeemed, Transaction, FundHourData } from '../generated/schema';

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

export function handleSetManager(event: SetManagerEvent): void {
    let fund = fetchFund(event.address)
    fund.manager = event.params.newManager.toHexString()
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
    userInFund.totalPurchaseValue = userInFund.totalPurchaseValue.plus(netAssetValuePerShare.times(shareAmount))
    userInFund.totalPurchaseShare = userInFund.totalPurchaseShare.plus(shareAmount)
    userInFund.costCollateral = userInFund.costCollateral.plus(netAssetValuePerShare.times(shareAmount))
    if (userInFund.firstPurchaseTime == 0) {
        userInFund.firstPurchaseTime = event.block.timestamp.toI32()
    }
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
    userInFund.totalRedeemedValue = userInFund.totalRedeemedValue.plus(returnedCollateral)
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

export function handleBlock(block: ethereum.Block): void {
    for (let i = 0; i < FUND_LIST.length; i++) {
        let fund = fetchFund(Address.fromString(FUND_LIST[i]))

        // hour data
        let timestamp = block.timestamp.toI32()
        let hourIndex = timestamp / 3600
        let hourStartUnix = hourIndex * 3600
        let hourFundID = FUND_LIST[i]
        .concat('-')
        .concat(BigInt.fromI32(hourIndex).toString())
        let fundHourData = FundHourData.load(hourFundID)
        if (fundHourData == null) {
            fundHourData = new FundHourData(hourFundID)
            fundHourData.fund = fund.id
            fundHourData.hourStartUnix = hourStartUnix
            let fundContract = FundContract.bind(Address.fromString(FUND_LIST[i]))
            let netAssetValuePerShare = ZERO_BD

            let callResult = fundContract.try_netAssetValuePerShare()
            if(callResult.reverted){
                log.warning("Get try_netAssetValuePerShare reverted at block: {}", [block.number.toString()])
            } else {
                netAssetValuePerShare = convertToDecimal(callResult.value, BI_18)
            }

            let perpetual = Perpetual.bind(Address.fromString(fund.perpetual))
            let markPrice = ONE_BD
            callResult = perpetual.try_markPrice()
            if(callResult.reverted){
                log.warning("Get try_markPrice reverted at block: {}", [block.number.toString()])
            } else {
                markPrice = convertToDecimal(callResult.value, BI_18)
            }

            let netValueInUSD = ZERO_BD
            let netValue = ZERO_BD

            if (isUSDCollateral(fund.collateral)) {
                netValueInUSD = netAssetValuePerShare
                netValue = netAssetValuePerShare.times(markPrice)
            } else {
                netValueInUSD = netAssetValuePerShare.div(markPrice)
                netValue = netAssetValuePerShare
            }
            // rsi strategy for AutoTradingFund
            let nextTarget = ZERO_BD
            let currentRSI = ZERO_BD
            if (fund.RSITrendingStrategy != "") {
                let strategy = RSITrendingStrategy.bind(Address.fromString(fund.RSITrendingStrategy))
                callResult = strategy.try_getCurrentRSI()
                if(callResult.reverted){
                    log.warning("Get try_getCurrentRSI reverted at block: {}", [block.number.toString()])
                } else {
                    currentRSI = convertToDecimal(callResult.value, BI_18)
                }

                callResult = strategy.try_getNextTarget()
                if(callResult.reverted){
                    log.warning("Get try_getNextTarget reverted at block: {}", [block.number.toString()])
                } else {
                    nextTarget = convertToDecimal(callResult.value, BI_18)
                }

            }
            fundHourData.netAssetValuePerShareUSD = netValueInUSD
            fundHourData.netAssetValuePerShareUnderlying = netValue
            fundHourData.nextTarget = nextTarget
            fundHourData.currentRSI = currentRSI
            fundHourData.save()
        }
    }
}
  
