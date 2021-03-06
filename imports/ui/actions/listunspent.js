import { Promise } from 'meteor/promise';
import { devlog } from './dev';
import { kmdCalcInterest } from './utils';
import { isAssetChain } from './utils';
import { verifyMerkleByCoin } from './merkle';
import { electrumJSTxDecoder } from './txDecoder/txDecoder';

const CONNECTION_ERROR_OR_INCOMPLETE_DATA = 'connection error or incomplete data';

const electrumJSNetworks = require('./electrumNetworks.js');

export const listunspent = (proxyServer, electrumServer, address, network, full, verify) => {
  let _atLeastOneDecodeTxFailed = false;

  if (full) {
    return new Promise((resolve, reject) => {
      HTTP.call('GET', `http://${proxyServer.ip}:${proxyServer.port}/api/listunspent`, {
        params: {
          port: electrumServer.port,
          ip: electrumServer.ip,
          proto: electrumServer.proto,
          address,
        },
      }, (error, result) => {
        result = JSON.parse(result.content);

        if (result.msg === 'error') {
          resolve('error');
        } else {
          const _utxoJSON = result.result;

          if (_utxoJSON &&
              _utxoJSON.length) {
            let formattedUtxoList = [];
            let _utxo = [];

            // get current height
            HTTP.call('GET', `http://${proxyServer.ip}:${proxyServer.port}/api/getcurrentblock`, {
              params: {
                port: electrumServer.port,
                ip: electrumServer.ip,
                proto: electrumServer.proto,
              },
            }, (error, result) => {
              result = JSON.parse(result.content);

              if (result.msg === 'error') {
                resolve('cant get current height');
              } else {
                const currentHeight = result.result;

                if (currentHeight &&
                    Number(currentHeight) > 0) {
                  // filter out unconfirmed utxos
                  for (let i = 0; i < _utxoJSON.length; i++) {
                    if (Number(currentHeight) - Number(_utxoJSON[i].height) !== 0) {
                      _utxo.push(_utxoJSON[i]);
                    }
                  }

                  if (!_utxo.length) { // no confirmed utxo
                    resolve('no valid utxo');
                  } else {
                    Promise.all(_utxo.map((_utxoItem, index) => {
                      return new Promise((resolve, reject) => {
                        HTTP.call('GET', `http://${proxyServer.ip}:${proxyServer.port}/api/gettransaction`, {
                          params: {
                            port: electrumServer.port,
                            ip: electrumServer.ip,
                            proto: electrumServer.proto,
                            address,
                            txid: _utxoItem['tx_hash'],
                          },
                        }, (error, result) => {
                          result = JSON.parse(result.content);

                          devlog('gettransaction =>');
                          devlog(result);

                          if (result.msg !== 'error') {
                            const _rawtxJSON = result.result;

                            devlog('electrum gettransaction ==>');
                            devlog(index + ' | ' + (_rawtxJSON.length - 1));
                            devlog(_rawtxJSON);

                            // decode tx
                            const _network = electrumJSNetworks[isAssetChain(network) ? 'komodo' : network];
                            const decodedTx = electrumJSTxDecoder(_rawtxJSON, network, _network);

                            devlog('decoded tx =>');
                            devlog(decodedTx);

                            if (!decodedTx) {
                              _atLeastOneDecodeTxFailed = true;
                              resolve('cant decode tx');
                            } else {
                              if (network === 'komodo' ||
                                  network === 'kmd') {
                                let interest = 0;

                                if (Number(_utxoItem.value) * 0.00000001 >= 10 &&
                                    decodedTx.format.locktime > 0) {
                                  interest = kmdCalcInterest(decodedTx.format.locktime, _utxoItem.value);
                                }

                                let _resolveObj = {
                                  txid: _utxoItem['tx_hash'],
                                  vout: _utxoItem['tx_pos'],
                                  address,
                                  amount: Number(_utxoItem.value) * 0.00000001,
                                  amountSats: _utxoItem.value,
                                  interest: interest,
                                  interestSats: Math.floor(interest * 100000000),
                                  confirmations: Number(_utxoItem.height) === 0 ? 0 : currentHeight - _utxoItem.height,
                                  spendable: true,
                                  verified: false,
                                  locktime: decodedTx.format.locktime,
                                };

                                // merkle root verification agains another electrum server
                                if (verify) {
                                  verifyMerkleByCoin(
                                    _utxoItem['tx_hash'],
                                    _utxoItem.height,
                                    electrumServer,
                                    proxyServer
                                  ).then((verifyMerkleRes) => {
                                    if (verifyMerkleRes &&
                                        verifyMerkleRes === CONNECTION_ERROR_OR_INCOMPLETE_DATA) {
                                      verifyMerkleRes = false;
                                    }

                                    _resolveObj.verified = verifyMerkleRes;
                                    resolve(_resolveObj);
                                  });
                                } else {
                                  resolve(_resolveObj);
                                }
                              } else {
                                let _resolveObj = {
                                  txid: _utxoItem['tx_hash'],
                                  vout: _utxoItem['tx_pos'],
                                  address,
                                  amount: Number(_utxoItem.value) * 0.00000001,
                                  amountSats: _utxoItem.value,
                                  confirmations: Number(_utxoItem.height) === 0 ? 0 : currentHeight - _utxoItem.height,
                                  spendable: true,
                                  verified: false,
                                };

                                // merkle root verification agains another electrum server
                                if (verify) {
                                  verifyMerkleByCoin(
                                    _utxoItem['tx_hash'],
                                    _utxoItem.height,
                                    electrumServer,
                                    proxyServer
                                  ).then((verifyMerkleRes) => {
                                    if (verifyMerkleRes &&
                                        verifyMerkleRes === CONNECTION_ERROR_OR_INCOMPLETE_DATA) {
                                      verifyMerkleRes = false;
                                    }

                                    _resolveObj.verified = verifyMerkleRes;
                                    resolve(_resolveObj);
                                  });
                                } else {
                                  resolve(_resolveObj);
                                }
                              }
                            }
                          }
                        });
                      });
                    }))
                    .then(promiseResult => {
                      if (!_atLeastOneDecodeTxFailed) {
                        devlog(promiseResult);
                        resolve(promiseResult);
                      } else {
                        devlog('listunspent error, cant decode tx(s)');
                        resolve('decode error');
                      }
                    });
                  }
                } else {
                  resolve('cant get current height');
                }
              }
            });
          } else {
            resolve(CONNECTION_ERROR_OR_INCOMPLETE_DATA);
          }
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      HTTP.call('GET', `http://${proxyServer.ip}:${proxyServer.port}/api/listunspent`, {
        params: {
          port: electrumServer.port,
          ip: electrumServer.ip,
          proto: electrumServer.proto,
          address,
        },
      }, (error, result) => {
        result = JSON.parse(result.content);

        if (result.msg === 'error') {
          resolve('error');
        } else {
          resolve(result.result);
        }
      });
    });
  }
}