// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Request, Response } from 'express';
import {HttpFunction, CloudEventFunction, HandlerFunction, TypedFunction, TypedInvocationFormat} from './functions';
import {SignatureType} from './types';

interface RegisteredFunction<T> {
  signatureType: SignatureType;
  userFunction: HandlerFunction<T>;
}

/**
 * Singleton map to hold the registered functions
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registrationContainer = new Map<string, RegisteredFunction<any>>();

/**
 * Helper method to store a registered function in the registration container
 */
const register = <T = unknown>(
  functionName: string,
  signatureType: SignatureType,
  userFunction: HandlerFunction<T>
): void => {
  if (!isValidFunctionName(functionName)) {
    throw new Error(`Invalid function name: ${functionName}`);
  }

  registrationContainer.set(functionName, {
    signatureType,
    userFunction,
  });
};

/**
 * Returns true if the function name is valid
 * - must contain only alphanumeric, numbers, or dash characters
 * - must be <= 63 characters
 * - must start with a letter
 * - must end with a letter or number
 * @param functionName the function name
 * @returns true if the function name is valid
 */
export const isValidFunctionName = (functionName: string): boolean => {
  // Validate function name with alpha characters, and dashes
  const regex = /^[A-Za-z](?:[-_A-Za-z0-9]{0,61}[A-Za-z0-9])?$/;
  return regex.test(functionName);
};

/**
 * Get a declaratively registered function
 * @param functionName the name with which the function was registered
 * @returns the registered function and signature type or undefined no function matching
 * the provided name has been registered.
 */
export const getRegisteredFunction = (
  functionName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): RegisteredFunction<any> | undefined => {
  return registrationContainer.get(functionName);
};

/**
 * Register a function that responds to HTTP requests.
 * @param functionName - the name of the function
 * @param handler - the function to invoke when handling HTTP requests
 * @public
 */
export const http = (functionName: string, handler: HttpFunction): void => {
  register(functionName, 'http', handler);
};

/**
 * Register a function that handles CloudEvents.
 * @param functionName - the name of the function
 * @param handler - the function to trigger when handling CloudEvents
 * @public
 */
export const cloudEvent = <T = unknown>(
  functionName: string,
  handler: CloudEventFunction<T>
): void => {
  register(functionName, 'cloudevent', handler);
};

/** Options bag for typed function registration. */
interface TypedFunctionOptions<T, U> {
  // Function registered to handle invocations.
  handler: TypedFunction<T, U>,
  // Optional formatter responsible for decoding the request and encoding the 
  // response.
  format?: TypedInvocationFormat<T, U>,
}

/** 
 * JsonFormat is the default implementation of request deserialization and 
 * result serialization.
 */
class JsonFormat<T, U> implements TypedInvocationFormat<T, U> {
  deserializeRequest(request: Request): T {
    if (typeof request.body !== "object") {
      throw new Error("request is not valid JSON or Content-Type header is set incorrectly");
    }
    return request.body as T;
  }

  serializeResponse(response: Response, result: U): void {
    response.header("content-type", "application/json");
    response.end(JSON.stringify(result));
  }
}

/**
 * Register a typed function that handles invocations.
 * @param functionName - the name of the function.
 * @param optOrHandler - the function to invoke when handling requests or an options bag of 
 * additional configuration.
 */
export const typed = <T, U>(functionName: string, optOrHandler: TypedFunction<T, U> | TypedFunctionOptions<T, U>): void => {
  let opt: TypedFunctionOptions<T, U> = optOrHandler instanceof Function ? {
    handler: optOrHandler,
  } : optOrHandler;

  const format = opt.format || new JsonFormat<T, U>();

  register(functionName, "typed", async (req: Request, res: Response): Promise<any> => {
    let parsed: T;
    try {
      const ret = format.deserializeRequest(req);
      if (ret instanceof Promise) {
        parsed = await ret;
      } else {
        parsed = ret;
      }
    } catch (e) {
      res.status(400).end("400 Bad Request");
      return;
    }
    
    let ret = await opt.handler(parsed);

    const promiseOrVoid: Promise<void> | void = format.serializeResponse(res, ret);
    if (promiseOrVoid instanceof Promise) {
      await promiseOrVoid;
    }
  });
};